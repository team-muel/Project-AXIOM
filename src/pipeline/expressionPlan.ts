import type {
    ComposeRequest,
    CompositionPlan,
    ExpressionGuidance,
    ExpressionPlanSidecar,
    OrnamentPlan,
    TempoMotionPlan,
    TextureGuidance,
} from "./types.js";

function cloneExpressionGuidance(expression: ExpressionGuidance | undefined): ExpressionGuidance | undefined {
    if (!expression) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(expression)) as ExpressionGuidance;
}

function cloneTextureGuidance(texture: TextureGuidance | undefined): TextureGuidance | undefined {
    if (!texture) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(texture)) as TextureGuidance;
}

function clonePhraseBreathPlan(
    phraseBreath: CompositionPlan["sections"][number]["phraseBreath"] | undefined,
): CompositionPlan["sections"][number]["phraseBreath"] | undefined {
    if (!phraseBreath) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(phraseBreath)) as CompositionPlan["sections"][number]["phraseBreath"];
}

function cloneTempoMotionPlans(tempoMotion: TempoMotionPlan[] | undefined): TempoMotionPlan[] | undefined {
    if (!tempoMotion) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(tempoMotion)) as TempoMotionPlan[];
}

function cloneOrnamentPlans(ornaments: OrnamentPlan[] | undefined): OrnamentPlan[] | undefined {
    if (!ornaments) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(ornaments)) as OrnamentPlan[];
}

function hasExpressionGuidance(expression: ExpressionGuidance | undefined): boolean {
    if (!expression) {
        return false;
    }

    return Boolean(
        expression.dynamics
        || expression.articulation?.length
        || expression.character?.length
        || expression.phrasePeaks?.length
        || expression.sustainBias !== undefined
        || expression.accentBias !== undefined
        || expression.notes?.length,
    );
}

function hasTextureGuidance(texture: TextureGuidance | undefined): boolean {
    if (!texture) {
        return false;
    }

    return Boolean(
        texture.voiceCount !== undefined
        || texture.primaryRoles?.length
        || texture.counterpointMode
        || texture.notes?.length,
    );
}

function hasPhraseBreathPlan(
    phraseBreath: CompositionPlan["sections"][number]["phraseBreath"] | undefined,
): boolean {
    if (!phraseBreath) {
        return false;
    }

    return Boolean(
        phraseBreath.pickupStartMeasure !== undefined
        || phraseBreath.pickupEndMeasure !== undefined
        || phraseBreath.arrivalMeasure !== undefined
        || phraseBreath.releaseStartMeasure !== undefined
        || phraseBreath.releaseEndMeasure !== undefined
        || phraseBreath.cadenceRecoveryStartMeasure !== undefined
        || phraseBreath.cadenceRecoveryEndMeasure !== undefined
        || phraseBreath.rubatoAnchors?.length
        || phraseBreath.notes?.length,
    );
}

function hasTempoMotionPlans(tempoMotion: TempoMotionPlan[] | undefined): boolean {
    return Boolean(tempoMotion?.length);
}

function hasOrnamentPlans(ornaments: OrnamentPlan[] | undefined): boolean {
    return Boolean(ornaments?.length);
}

export function buildExpressionPlanSidecar(plan: CompositionPlan | undefined): ExpressionPlanSidecar | undefined {
    if (!plan) {
        return undefined;
    }

    const textureDefaults = cloneTextureGuidance(plan.textureDefaults);
    const expressionDefaults = cloneExpressionGuidance(plan.expressionDefaults);
    const tempoMotionDefaults = cloneTempoMotionPlans(plan.tempoMotionDefaults);
    const ornamentDefaults = cloneOrnamentPlans(plan.ornamentDefaults);
    const includeAllSectionsForDefaults = hasTextureGuidance(textureDefaults)
        || hasExpressionGuidance(expressionDefaults)
        || hasTempoMotionPlans(tempoMotionDefaults)
        || hasOrnamentPlans(ornamentDefaults);
    let startMeasure = 1;
    const sections = plan.sections.flatMap((section) => {
        const endMeasure = startMeasure + Math.max(1, section.measures) - 1;
        const sectionEntry = {
            sectionId: section.id,
            startMeasure,
            endMeasure,
            ...(section.phraseFunction ? { phraseFunction: section.phraseFunction } : {}),
            ...(hasPhraseBreathPlan(section.phraseBreath) ? { phraseBreath: clonePhraseBreathPlan(section.phraseBreath) } : {}),
            ...(hasTextureGuidance(section.texture) ? { texture: cloneTextureGuidance(section.texture) } : {}),
            ...(hasExpressionGuidance(section.expression) ? { expression: cloneExpressionGuidance(section.expression) } : {}),
            ...(hasTempoMotionPlans(section.tempoMotion) ? { tempoMotion: cloneTempoMotionPlans(section.tempoMotion) } : {}),
            ...(hasOrnamentPlans(section.ornaments) ? { ornaments: cloneOrnamentPlans(section.ornaments) } : {}),
        };
        startMeasure = endMeasure + 1;

        return includeAllSectionsForDefaults
            || section.phraseFunction
            || hasPhraseBreathPlan(section.phraseBreath)
            || hasTextureGuidance(section.texture)
            || hasExpressionGuidance(section.expression)
            || hasTempoMotionPlans(section.tempoMotion)
            || hasOrnamentPlans(section.ornaments)
            ? [sectionEntry]
            : [];
    });

    if (!hasTextureGuidance(textureDefaults)
        && !hasExpressionGuidance(expressionDefaults)
        && !hasTempoMotionPlans(tempoMotionDefaults)
        && !hasOrnamentPlans(ornamentDefaults)
        && sections.length === 0) {
        return undefined;
    }

    return {
        version: plan.version,
        humanizationStyle: plan.humanizationStyle,
        ...(hasTextureGuidance(textureDefaults) ? { textureDefaults } : {}),
        ...(hasExpressionGuidance(expressionDefaults) ? { expressionDefaults } : {}),
        ...(hasTempoMotionPlans(tempoMotionDefaults) ? { tempoMotionDefaults } : {}),
        ...(hasOrnamentPlans(ornamentDefaults) ? { ornamentDefaults } : {}),
        sections,
    };
}

export function mergeExpressionPlanIntoCompositionPlan(
    plan: CompositionPlan | undefined,
    sidecar: ExpressionPlanSidecar | undefined,
): CompositionPlan | undefined {
    if (!plan || !sidecar) {
        return plan;
    }

    const expressionBySectionId = new Map(
        sidecar.sections
            .filter((entry) => hasExpressionGuidance(entry.expression))
            .map((entry) => [entry.sectionId, cloneExpressionGuidance(entry.expression)]),
    );
    const phraseBreathBySectionId = new Map(
        sidecar.sections
            .filter((entry) => hasPhraseBreathPlan(entry.phraseBreath))
            .map((entry) => [entry.sectionId, clonePhraseBreathPlan(entry.phraseBreath)]),
    );
    const tempoMotionBySectionId = new Map(
        sidecar.sections
            .filter((entry) => hasTempoMotionPlans(entry.tempoMotion))
            .map((entry) => [entry.sectionId, cloneTempoMotionPlans(entry.tempoMotion)]),
    );
    const ornamentsBySectionId = new Map(
        sidecar.sections
            .filter((entry) => hasOrnamentPlans(entry.ornaments))
            .map((entry) => [entry.sectionId, cloneOrnamentPlans(entry.ornaments)]),
    );
    const nextPlan = JSON.parse(JSON.stringify(plan)) as CompositionPlan;
    let changed = false;

    if (hasExpressionGuidance(sidecar.expressionDefaults)) {
        nextPlan.expressionDefaults = cloneExpressionGuidance(sidecar.expressionDefaults);
        changed = true;
    }

    if (hasTextureGuidance(sidecar.textureDefaults)) {
        nextPlan.textureDefaults = cloneTextureGuidance(sidecar.textureDefaults);
        changed = true;
    }

    if (hasTempoMotionPlans(sidecar.tempoMotionDefaults)) {
        nextPlan.tempoMotionDefaults = cloneTempoMotionPlans(sidecar.tempoMotionDefaults);
        changed = true;
    }

    if (hasOrnamentPlans(sidecar.ornamentDefaults)) {
        nextPlan.ornamentDefaults = cloneOrnamentPlans(sidecar.ornamentDefaults);
        changed = true;
    }

    if (sidecar.humanizationStyle && !nextPlan.humanizationStyle) {
        nextPlan.humanizationStyle = sidecar.humanizationStyle;
        changed = true;
    }

    nextPlan.sections = nextPlan.sections.map((section) => {
        const sidecarSection = sidecar.sections.find((entry) => entry.sectionId === section.id);
        const expression = expressionBySectionId.get(section.id);
        const phraseBreath = phraseBreathBySectionId.get(section.id);
        const texture = cloneTextureGuidance(sidecarSection?.texture);
        const tempoMotion = tempoMotionBySectionId.get(section.id);
        const ornaments = ornamentsBySectionId.get(section.id);
        const phraseFunction = sidecarSection?.phraseFunction;
        if (!phraseFunction
            && !hasPhraseBreathPlan(phraseBreath)
            && !hasTextureGuidance(texture)
            && !hasExpressionGuidance(expression)
            && !hasTempoMotionPlans(tempoMotion)
            && !hasOrnamentPlans(ornaments)) {
            return section;
        }

        changed = true;
        return {
            ...section,
            ...(phraseFunction ? { phraseFunction } : {}),
            ...(hasPhraseBreathPlan(phraseBreath) ? { phraseBreath } : {}),
            ...(hasTextureGuidance(texture) ? { texture } : {}),
            ...(hasExpressionGuidance(expression) ? { expression } : {}),
            ...(hasTempoMotionPlans(tempoMotion) ? { tempoMotion } : {}),
            ...(hasOrnamentPlans(ornaments) ? { ornaments } : {}),
        };
    });

    return changed ? nextPlan : plan;
}

export function mergeExpressionPlanIntoRequest(
    request: ComposeRequest,
    sidecar: ExpressionPlanSidecar | undefined,
): ComposeRequest {
    if (!sidecar || !request.compositionPlan) {
        return request;
    }

    const mergedPlan = mergeExpressionPlanIntoCompositionPlan(request.compositionPlan, sidecar);
    if (!mergedPlan || mergedPlan === request.compositionPlan) {
        return request;
    }

    return {
        ...request,
        compositionPlan: mergedPlan,
        plannerVersion: request.plannerVersion ?? mergedPlan.version,
    };
}