import crypto from "node:crypto";
import type {
    ComposeRequest,
    ComposeSource,
    ExpressionGuidance,
    HarmonicColorCue,
    HarmonicPlan,
    LongSpanFormPlan,
    PhraseBreathPlan,
    TextureGuidance,
    TonicizationWindow,
} from "../pipeline/types.js";
import { summarizeOrchestrationPlan } from "../pipeline/orchestrationPlan.js";

function compact(value: unknown): string {
    return String(value ?? "").trim().replace(/\s+/g, " ");
}

function summarizeSelectedModels(request: Pick<ComposeRequest, "selectedModels">): string[] {
    return (request.selectedModels ?? [])
        .map((binding) => [binding.role, binding.provider, binding.model, binding.version ?? ""]
            .map((value) => compact(value).toLowerCase())
            .join(":"))
        .sort();
}

function summarizeRevisionDirectives(request: Pick<ComposeRequest, "revisionDirectives" | "attemptIndex">): Record<string, unknown> | null {
    if (!request.revisionDirectives?.length) {
        return null;
    }

    return {
        attemptIndex: request.attemptIndex ?? null,
        directives: request.revisionDirectives.map((directive) => ({
            kind: compact(directive.kind).toLowerCase(),
            priority: directive.priority,
            reason: compact(directive.reason).toLowerCase(),
            sourceIssue: compact(directive.sourceIssue).toLowerCase(),
            sectionIds: (directive.sectionIds ?? []).map((sectionId) => compact(sectionId).toLowerCase()).sort(),
        })),
    };
}

function summarizeQualityPolicy(request: Pick<ComposeRequest, "qualityPolicy">): Record<string, unknown> | null {
    const policy = request.qualityPolicy;
    if (!policy) {
        return null;
    }

    return {
        enableAutoRevision: policy.enableAutoRevision ?? null,
        maxStructureAttempts: policy.maxStructureAttempts ?? null,
        targetStructureScore: policy.targetStructureScore ?? null,
        targetAudioScore: policy.targetAudioScore ?? null,
    };
}

function summarizeExpressionGuidance(expression: ExpressionGuidance | undefined): Record<string, unknown> | null {
    if (!expression) {
        return null;
    }

    return {
        dynamics: expression.dynamics
            ? {
                start: compact(expression.dynamics.start),
                peak: compact(expression.dynamics.peak),
                end: compact(expression.dynamics.end),
                hairpins: (expression.dynamics.hairpins ?? []).map((hairpin) => ({
                    shape: compact(hairpin.shape),
                    startMeasure: hairpin.startMeasure ?? null,
                    endMeasure: hairpin.endMeasure ?? null,
                    target: compact(hairpin.target),
                })),
            }
            : null,
        articulation: (expression.articulation ?? []).map((item) => compact(item).toLowerCase()).sort(),
        character: (expression.character ?? []).map((item) => compact(item).toLowerCase()).sort(),
        phrasePeaks: expression.phrasePeaks ?? null,
        sustainBias: expression.sustainBias ?? null,
        accentBias: expression.accentBias ?? null,
    };
}

function summarizeTextureGuidance(texture: TextureGuidance | undefined): Record<string, unknown> | null {
    if (!texture) {
        return null;
    }

    return {
        voiceCount: texture.voiceCount ?? null,
        primaryRoles: (texture.primaryRoles ?? []).map((item) => compact(item).toLowerCase()).sort(),
        counterpointMode: compact(texture.counterpointMode).toLowerCase(),
    };
}

function summarizeTonicizationWindows(windows: TonicizationWindow[] | undefined): Array<Record<string, unknown>> | null {
    if (!windows?.length) {
        return null;
    }

    return windows
        .map((window) => ({
            keyTarget: compact(window.keyTarget).toLowerCase(),
            startMeasure: window.startMeasure ?? null,
            endMeasure: window.endMeasure ?? null,
            emphasis: compact(window.emphasis).toLowerCase(),
            cadence: compact(window.cadence).toLowerCase(),
        }))
        .sort((left, right) => {
            const leftKey = [left.startMeasure ?? 0, left.endMeasure ?? 0, left.keyTarget, left.emphasis, left.cadence].join(":");
            const rightKey = [right.startMeasure ?? 0, right.endMeasure ?? 0, right.keyTarget, right.emphasis, right.cadence].join(":");
            return leftKey.localeCompare(rightKey);
        });
}

function summarizeHarmonicColorCues(colorCues: HarmonicColorCue[] | undefined): Array<Record<string, unknown>> | null {
    if (!colorCues?.length) {
        return null;
    }

    return colorCues
        .map((cue) => ({
            tag: compact(cue.tag).toLowerCase(),
            startMeasure: cue.startMeasure ?? null,
            endMeasure: cue.endMeasure ?? null,
            keyTarget: compact(cue.keyTarget).toLowerCase(),
            resolutionMeasure: cue.resolutionMeasure ?? null,
            intensity: cue.intensity ?? null,
            notes: (cue.notes ?? []).map((item) => compact(item).toLowerCase()).sort(),
        }))
        .sort((left, right) => {
            const leftKey = [
                left.tag,
                left.startMeasure ?? 0,
                left.endMeasure ?? 0,
                left.keyTarget,
                left.resolutionMeasure ?? 0,
                left.intensity ?? 0,
                left.notes.join("+"),
            ].join(":");
            const rightKey = [
                right.tag,
                right.startMeasure ?? 0,
                right.endMeasure ?? 0,
                right.keyTarget,
                right.resolutionMeasure ?? 0,
                right.intensity ?? 0,
                right.notes.join("+"),
            ].join(":");
            return leftKey.localeCompare(rightKey);
        });
}

function summarizeHarmonicPlan(harmonicPlan: HarmonicPlan | undefined): Record<string, unknown> | null {
    if (!harmonicPlan) {
        return null;
    }

    return {
        tonalCenter: compact(harmonicPlan.tonalCenter).toLowerCase(),
        keyTarget: compact(harmonicPlan.keyTarget).toLowerCase(),
        modulationPath: (harmonicPlan.modulationPath ?? []).map((value) => compact(value).toLowerCase()),
        harmonicRhythm: compact(harmonicPlan.harmonicRhythm).toLowerCase(),
        harmonyDensity: compact(harmonicPlan.harmonyDensity).toLowerCase(),
        voicingProfile: compact(harmonicPlan.voicingProfile).toLowerCase(),
        prolongationMode: compact(harmonicPlan.prolongationMode).toLowerCase(),
        tonicizationWindows: summarizeTonicizationWindows(harmonicPlan.tonicizationWindows),
        colorCues: summarizeHarmonicColorCues(harmonicPlan.colorCues),
        tensionTarget: harmonicPlan.tensionTarget ?? null,
        cadence: compact(harmonicPlan.cadence).toLowerCase(),
        allowModulation: harmonicPlan.allowModulation ?? null,
    };
}

function summarizePhraseBreathPlan(phraseBreath: PhraseBreathPlan | undefined): Record<string, unknown> | null {
    if (!phraseBreath) {
        return null;
    }

    return {
        pickupStartMeasure: phraseBreath.pickupStartMeasure ?? null,
        pickupEndMeasure: phraseBreath.pickupEndMeasure ?? null,
        arrivalMeasure: phraseBreath.arrivalMeasure ?? null,
        releaseStartMeasure: phraseBreath.releaseStartMeasure ?? null,
        releaseEndMeasure: phraseBreath.releaseEndMeasure ?? null,
        cadenceRecoveryStartMeasure: phraseBreath.cadenceRecoveryStartMeasure ?? null,
        cadenceRecoveryEndMeasure: phraseBreath.cadenceRecoveryEndMeasure ?? null,
        rubatoAnchors: phraseBreath.rubatoAnchors ?? null,
        notes: (phraseBreath.notes ?? []).map((item) => compact(item).toLowerCase()),
    };
}

function summarizeLongSpanForm(longSpanForm: LongSpanFormPlan | undefined): Record<string, unknown> | null {
    if (!longSpanForm) {
        return null;
    }

    return {
        expositionStartSectionId: compact(longSpanForm.expositionStartSectionId).toLowerCase(),
        expositionEndSectionId: compact(longSpanForm.expositionEndSectionId).toLowerCase(),
        developmentStartSectionId: compact(longSpanForm.developmentStartSectionId).toLowerCase(),
        developmentEndSectionId: compact(longSpanForm.developmentEndSectionId).toLowerCase(),
        retransitionSectionId: compact(longSpanForm.retransitionSectionId).toLowerCase(),
        recapStartSectionId: compact(longSpanForm.recapStartSectionId).toLowerCase(),
        returnSectionId: compact(longSpanForm.returnSectionId).toLowerCase(),
        delayedPayoffSectionId: compact(longSpanForm.delayedPayoffSectionId).toLowerCase(),
        expectedDevelopmentPressure: compact(longSpanForm.expectedDevelopmentPressure).toLowerCase(),
        expectedReturnPayoff: compact(longSpanForm.expectedReturnPayoff).toLowerCase(),
        thematicCheckpoints: (longSpanForm.thematicCheckpoints ?? []).map((checkpoint) => ({
            id: compact(checkpoint.id).toLowerCase(),
            sourceSectionId: compact(checkpoint.sourceSectionId).toLowerCase(),
            targetSectionId: compact(checkpoint.targetSectionId).toLowerCase(),
            transform: compact(checkpoint.transform).toLowerCase(),
            expectedProminence: checkpoint.expectedProminence ?? null,
            preserveIdentity: checkpoint.preserveIdentity ?? null,
            notes: (checkpoint.notes ?? []).map((item) => compact(item).toLowerCase()),
        })),
        notes: (longSpanForm.notes ?? []).map((item) => compact(item).toLowerCase()),
    };
}

function summarizeCompositionPlan(request: Pick<ComposeRequest, "compositionPlan">): Record<string, unknown> | null {
    const plan = request.compositionPlan;
    if (!plan) {
        return null;
    }

    return {
        version: compact(plan.version),
        form: compact(plan.form),
        inspirationThread: compact(plan.inspirationThread),
        intentRationale: compact(plan.intentRationale),
        contrastTarget: compact(plan.contrastTarget),
        riskProfile: compact(plan.riskProfile),
        structureVisibility: compact(plan.structureVisibility),
        humanizationStyle: compact(plan.humanizationStyle),
        key: compact(plan.key),
        tempo: plan.tempo ?? null,
        meter: compact(plan.meter),
        workflow: compact(plan.workflow),
        textureDefaults: summarizeTextureGuidance(plan.textureDefaults),
        expressionDefaults: summarizeExpressionGuidance(plan.expressionDefaults),
        instrumentation: plan.instrumentation
            .map((instrument) => [
                compact(instrument.name).toLowerCase(),
                compact(instrument.family).toLowerCase(),
                instrument.roles.map((role) => compact(role).toLowerCase()).sort().join("+"),
                compact(instrument.register).toLowerCase(),
            ].join(":"))
            .sort(),
        sketch: plan.sketch?.generatedBy === "planner"
            ? {
                generatedBy: compact(plan.sketch.generatedBy),
                motifDrafts: plan.sketch.motifDrafts.map((draft) => ({
                    id: compact(draft.id),
                    sectionId: compact(draft.sectionId),
                    intervals: draft.intervals,
                })),
                cadenceOptions: plan.sketch.cadenceOptions.map((option) => ({
                    sectionId: compact(option.sectionId),
                    primary: compact(option.primary),
                    alternatives: option.alternatives.map((cadence) => compact(cadence)),
                })),
            }
            : null,
        longSpanForm: summarizeLongSpanForm(plan.longSpanForm),
        orchestration: summarizeOrchestrationPlan(plan.orchestration),
        sections: plan.sections.map((section) => ({
            id: compact(section.id),
            role: compact(section.role),
            measures: section.measures,
            energy: section.energy,
            density: section.density,
            phraseFunction: compact(section.phraseFunction),
            phraseBreath: summarizePhraseBreathPlan(section.phraseBreath),
            phraseSpanShape: compact(section.phraseSpanShape),
            continuationPressure: compact(section.continuationPressure),
            cadentialBuildup: compact(section.cadentialBuildup),
            cadence: compact(section.cadence),
            motifRef: compact(section.motifRef),
            contrastFrom: compact(section.contrastFrom),
            harmonicPlan: summarizeHarmonicPlan(section.harmonicPlan),
            texture: summarizeTextureGuidance(section.texture),
            expression: summarizeExpressionGuidance(section.expression),
        })),
    };
}

export function computePromptHash(
    request: Pick<ComposeRequest, "prompt" | "key" | "tempo" | "form" | "durationSec" | "workflow" | "plannerVersion" | "selectedModels" | "compositionPlan" | "qualityPolicy" | "revisionDirectives" | "attemptIndex">,
): string {
    const payload = {
        prompt: compact(request.prompt),
        key: compact(request.key),
        tempo: request.tempo ?? null,
        form: compact(request.form),
        durationSec: request.durationSec ?? null,
        workflow: compact(request.workflow),
        plannerVersion: compact(request.plannerVersion),
        selectedModels: summarizeSelectedModels(request),
        compositionPlan: summarizeCompositionPlan(request),
        qualityPolicy: summarizeQualityPolicy(request),
        revisionDirectives: summarizeRevisionDirectives(request),
    };

    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function ensureComposeRequestMetadata(
    request: ComposeRequest,
    defaultSource: ComposeSource = "api",
): ComposeRequest {
    return {
        ...request,
        source: request.source ?? defaultSource,
        promptHash: request.promptHash ?? computePromptHash(request),
    };
}