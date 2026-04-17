import type {
    AutonomyBassMotionPattern,
    AutonomyCadenceApproachPattern,
    AutonomyMotifReturnPattern,
    AutonomyPreferences,
    AutonomyRegisterCenterPattern,
    AutonomySectionStylePattern,
    AutonomyTensionArcPattern,
} from "../autonomy/types.js";
import { loadAutonomyPreferences } from "../memory/manifest.js";
import type {
    CadenceOption,
    CadenceStyle,
    CompositionSketch,
    ComposeRequest,
    MotifDraft,
    PlanRiskProfile,
    SectionPlan,
    StructureVisibility,
} from "./types.js";

const MOTIF_ROLES = new Set(["intro", "theme_a", "theme_b", "bridge", "development", "variation", "recap"]);
const CADENCE_ROLES = new Set(["cadence", "outro", "recap"]);

interface SketchMemoryBias {
    motifReturns: AutonomyMotifReturnPattern[];
    registerCenters: AutonomyRegisterCenterPattern[];
    cadenceApproaches: AutonomyCadenceApproachPattern[];
    bassMotionProfiles: AutonomyBassMotionPattern[];
    sectionStyles: AutonomySectionStylePattern[];
    tensionArc?: number[];
    notes: string[];
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function normalizeCadence(value: unknown): CadenceStyle | undefined {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "open" || normalized === "half" || normalized === "authentic" || normalized === "plagal" || normalized === "deceptive") {
        return normalized;
    }
    return undefined;
}

function uniqueCadences(values: CadenceStyle[]): CadenceStyle[] {
    return Array.from(new Set(values));
}

function resampleValues(values: number[], targetLength: number): number[] {
    if (targetLength <= 0) {
        return [];
    }
    if (values.length === 0) {
        return [];
    }
    if (values.length === targetLength) {
        return [...values];
    }
    if (values.length === 1) {
        return Array.from({ length: targetLength }, () => values[0]);
    }

    const result: number[] = [];
    const lastIndex = values.length - 1;
    for (let index = 0; index < targetLength; index += 1) {
        const position = (index / Math.max(targetLength - 1, 1)) * lastIndex;
        const leftIndex = Math.floor(position);
        const rightIndex = Math.min(leftIndex + 1, lastIndex);
        const fraction = position - leftIndex;
        result.push(Number(((values[leftIndex] * (1 - fraction)) + (values[rightIndex] * fraction)).toFixed(4)));
    }
    return result;
}

function sectionTensionTarget(section: SectionPlan): number {
    if (typeof section.harmonicPlan?.tensionTarget === "number") {
        return clamp(section.harmonicPlan.tensionTarget, 0, 1);
    }

    return Number(clamp((section.energy * 0.65) + (section.density * 0.35), 0, 1).toFixed(4));
}

function scoreTensionPatternMatch(pattern: AutonomyTensionArcPattern, form: string, sections: SectionPlan[]): number {
    let score = pattern.count * 4;
    if (pattern.form && pattern.form === form) {
        score += 12;
    }
    if (pattern.sectionRoles.length === sections.length) {
        score += 8;
    }

    for (let index = 0; index < Math.min(pattern.sectionRoles.length, sections.length); index += 1) {
        if (pattern.sectionRoles[index] === sections[index]?.role) {
            score += 3;
        }
    }

    return score;
}

function scoreFormMemoryMatch(patternForm: string | undefined, form: string): number {
    if (patternForm && patternForm === form) {
        return 2;
    }
    if (!patternForm) {
        return 1;
    }
    return 0;
}

function selectTensionArcBias(
    patterns: AutonomyTensionArcPattern[] | undefined,
    form: string,
    sections: SectionPlan[],
): number[] | undefined {
    if (!patterns?.length || sections.length === 0) {
        return undefined;
    }

    const bestPattern = [...patterns]
        .sort((left, right) => scoreTensionPatternMatch(right, form, sections) - scoreTensionPatternMatch(left, form, sections))[0];
    if (!bestPattern?.values.length) {
        return undefined;
    }

    return resampleValues(bestPattern.values, sections.length);
}

function selectRegisterCenterBias(
    patterns: AutonomyRegisterCenterPattern[],
    form: string,
    role: SectionPlan["role"],
): number | undefined {
    return [...patterns]
        .filter((pattern) => pattern.role === role)
        .sort((left, right) => (
            scoreFormMemoryMatch(right.form, form) - scoreFormMemoryMatch(left.form, form)
            || right.count - left.count
        ))[0]
        ?.registerCenter;
}

function selectCadenceApproachBias(
    patterns: AutonomyCadenceApproachPattern[],
    form: string,
    role: SectionPlan["role"],
): AutonomyCadenceApproachPattern | undefined {
    return [...patterns]
        .filter((pattern) => pattern.role === role)
        .sort((left, right) => (
            scoreFormMemoryMatch(right.form, form) - scoreFormMemoryMatch(left.form, form)
            || right.count - left.count
        ))[0];
}

function selectBassMotionProfileBias(
    patterns: AutonomyBassMotionPattern[],
    form: string,
    role: SectionPlan["role"],
): AutonomyBassMotionPattern | undefined {
    return [...patterns]
        .filter((pattern) => pattern.role === role)
        .sort((left, right) => (
            scoreFormMemoryMatch(right.form, form) - scoreFormMemoryMatch(left.form, form)
            || right.count - left.count
        ))[0];
}

function selectSectionStyleBias(
    patterns: AutonomySectionStylePattern[],
    form: string,
    role: SectionPlan["role"],
): AutonomySectionStylePattern | undefined {
    return [...patterns]
        .filter((pattern) => pattern.role === role)
        .sort((left, right) => (
            scoreFormMemoryMatch(right.form, form) - scoreFormMemoryMatch(left.form, form)
            || right.count - left.count
        ))[0];
}

function applyRegisterCenterBias(intervals: number[], registerCenter: number | undefined): number[] {
    if (typeof registerCenter !== "number") {
        return intervals;
    }

    if (registerCenter >= 68) {
        return intervals.map((interval, index) => {
            if (index === 0) {
                return interval;
            }
            if (interval > 0) {
                return clamp(interval + 1, -7, 7);
            }
            if (interval === 0 && index === intervals.length - 1) {
                return 1;
            }
            return interval;
        });
    }

    if (registerCenter <= 55) {
        return intervals.map((interval, index) => {
            if (index === 0) {
                return interval;
            }
            if (interval < 0) {
                return clamp(interval - 1, -7, 7);
            }
            if (interval === 0 && index === intervals.length - 1) {
                return -1;
            }
            return interval;
        });
    }

    return intervals;
}

function applyBassMotionBias(
    intervals: number[],
    bassMotionProfile: AutonomyBassMotionPattern["bassMotionProfile"] | undefined,
): number[] {
    if (!bassMotionProfile) {
        return intervals;
    }

    if (bassMotionProfile === "pedal") {
        return intervals.map((interval, index) => {
            if (index === 0) {
                return interval;
            }
            if (index === intervals.length - 1 || index % 2 === 0) {
                return 0;
            }
            return clamp(interval, -2, 2);
        });
    }

    if (bassMotionProfile === "stepwise") {
        return intervals.map((interval, index) => index === 0 ? interval : clamp(interval, -2, 2));
    }

    if (bassMotionProfile === "leaping") {
        return intervals.map((interval, index) => {
            if (index === 0) {
                return interval;
            }
            if (interval === 0) {
                return index === intervals.length - 1 ? 0 : (index % 2 === 0 ? 3 : -3);
            }
            return clamp(interval + (interval > 0 ? 2 : -2), -7, 7);
        });
    }

    return intervals.map((interval, index) => {
        if (index === 0) {
            return interval;
        }
        if (index === 2 && interval !== 0) {
            return clamp(interval + Math.sign(interval), -6, 6);
        }
        return clamp(interval, -4, 4);
    });
}

function applySectionStyleBias(intervals: number[], sectionStyle: string | undefined): number[] {
    const normalized = String(sectionStyle ?? "").trim().toLowerCase();
    if (!normalized) {
        return intervals;
    }

    const direction = Math.sign(intervals.find((interval, index) => index > 0 && interval !== 0) ?? 1) || 1;

    if (normalized === "block") {
        return intervals.map((interval, index) => {
            if (index === 0) {
                return interval;
            }
            if (index === intervals.length - 1) {
                return 0;
            }
            return clamp(interval, -4, 4);
        });
    }

    if (normalized === "broken") {
        return intervals.map((interval, index) => {
            if (index === 0) {
                return interval;
            }
            if (interval === 0 && index < intervals.length - 1) {
                return index % 2 === 0 ? direction * 3 : direction * 2;
            }
            return interval;
        });
    }

    if (normalized === "arpeggio") {
        return intervals.map((interval, index) => {
            if (index === 0) {
                return interval;
            }
            if (interval === 0 && index < intervals.length - 1) {
                return index % 2 === 0 ? direction * 2 : direction;
            }
            if (Math.abs(interval) <= 1) {
                return clamp(interval + direction, -6, 6);
            }
            return interval;
        });
    }

    if (normalized === "march") {
        return intervals.map((interval, index) => {
            if (index === 0) {
                return interval;
            }
            if (index % 2 === 1) {
                return clamp(interval + (interval >= 0 ? 1 : -1), -7, 7);
            }
            return clamp(interval, -6, 6);
        });
    }

    if (normalized === "waltz") {
        return intervals.map((interval, index) => {
            if (index === 0) {
                return interval;
            }
            if (index === 1) {
                return direction;
            }
            if (index === 2) {
                return clamp(direction * -3, -5, 5);
            }
            if (index === intervals.length - 1) {
                return 0;
            }
            return clamp(direction * 2, -4, 4);
        });
    }

    return intervals;
}

function loadSketchMemoryBias(request: ComposeRequest, plan: NonNullable<ComposeRequest["compositionPlan"]>): SketchMemoryBias {
    if (request.source !== "autonomy") {
        return {
            motifReturns: [],
            registerCenters: [],
            cadenceApproaches: [],
            bassMotionProfiles: [],
            sectionStyles: [],
            notes: [],
        };
    }

    const preferences: AutonomyPreferences = loadAutonomyPreferences();
    const tensionArc = selectTensionArcBias(preferences.successfulTensionArcs, plan.form, plan.sections);
    const motifReturns = (preferences.successfulMotifReturns ?? [])
        .filter((pattern) => !pattern.form || pattern.form === plan.form)
        .sort((left, right) => right.count - left.count)
        .slice(0, 6);
    const registerCenters = (preferences.successfulRegisterCenters ?? [])
        .filter((pattern) => !pattern.form || pattern.form === plan.form)
        .sort((left, right) => right.count - left.count)
        .slice(0, 6);
    const cadenceApproaches = (preferences.successfulCadenceApproaches ?? [])
        .filter((pattern) => !pattern.form || pattern.form === plan.form)
        .sort((left, right) => right.count - left.count)
        .slice(0, 6);
    const bassMotionProfiles = (preferences.successfulBassMotionProfiles ?? [])
        .filter((pattern) => !pattern.form || pattern.form === plan.form)
        .sort((left, right) => right.count - left.count)
        .slice(0, 6);
    const sectionStyles = (preferences.successfulSectionStyles ?? [])
        .filter((pattern) => !pattern.form || pattern.form === plan.form)
        .sort((left, right) => right.count - left.count)
        .slice(0, 6);
    const notes: string[] = [];

    if (motifReturns.length > 0) {
        notes.push(`motif return memory x${motifReturns[0].count}`);
    }
    if (tensionArc?.length) {
        notes.push(`tension arc memory [${tensionArc.map((value) => value.toFixed(2)).join(",")}]`);
    }
    if (registerCenters.length > 0) {
        notes.push(`register center memory ${registerCenters[0].role}@${registerCenters[0].registerCenter}`);
    }
    if (cadenceApproaches.length > 0) {
        notes.push(`cadence approach memory ${cadenceApproaches[0].role}/${cadenceApproaches[0].cadenceApproach}`);
    }
    if (bassMotionProfiles.length > 0) {
        notes.push(`bass motion memory ${bassMotionProfiles[0].role}/${bassMotionProfiles[0].bassMotionProfile}`);
    }
    if (sectionStyles.length > 0) {
        notes.push(`section style memory ${sectionStyles[0].role}/${sectionStyles[0].sectionStyle}`);
    }

    return {
        motifReturns,
        registerCenters,
        cadenceApproaches,
        bassMotionProfiles,
        sectionStyles,
        tensionArc,
        notes,
    };
}

function contourDirection(request: ComposeRequest, index: number): number {
    const contour = request.compositionProfile?.pitchContour;
    if (!contour?.length) {
        return index % 2 === 0 ? 1 : -1;
    }

    const current = contour[index % contour.length] ?? contour[0] ?? 0.5;
    const next = contour[(index + 1) % contour.length] ?? current;
    if (next > current + 0.04) {
        return 1;
    }
    if (next < current - 0.04) {
        return -1;
    }
    return index % 2 === 0 ? 1 : -1;
}

function deriveMotifIntervals(
    section: SectionPlan,
    index: number,
    request: ComposeRequest,
    riskProfile: PlanRiskProfile | undefined,
    structureVisibility: StructureVisibility | undefined,
    tensionTarget?: number,
    registerCenter?: number,
    bassMotionProfile?: AutonomyBassMotionPattern["bassMotionProfile"],
    sectionStyle?: string,
): number[] {
    const direction = contourDirection(request, index);
    const effectiveTension = tensionTarget ?? sectionTensionTarget(section);
    const stepSize = Math.max(section.density >= 0.48 ? 2 : 1, effectiveTension >= 0.66 ? 2 : 1);
    const leapSizeBase = section.energy >= 0.58 ? 5 : (section.energy >= 0.4 ? 4 : 3);
    const leapSize = leapSizeBase + (effectiveTension >= 0.72 ? 1 : 0);

    let intervals: number[];
    switch (section.role) {
        case "theme_b":
        case "bridge":
            intervals = [0, direction * stepSize, -direction * stepSize, direction * leapSize, 0];
            break;
        case "development":
            intervals = [0, direction * leapSize, -direction * (stepSize + 1), direction * (leapSize + 1), -direction * stepSize];
            break;
        case "variation":
            intervals = [0, direction, direction * leapSize, 0, -direction * (stepSize + 1)];
            break;
        case "recap":
            intervals = [0, direction * stepSize, direction * (stepSize + 1), 0];
            break;
        default:
            intervals = [0, direction * stepSize, direction * leapSize, direction * stepSize, 0];
            break;
    }

    if (riskProfile === "experimental") {
        intervals = intervals.map((interval, intervalIndex) => {
            if (intervalIndex === 2) {
                return interval + (direction * 2);
            }
            return interval;
        });
    } else if (riskProfile === "conservative") {
        intervals = intervals.map((interval) => clamp(interval, -4, 4));
    }

    if (structureVisibility === "hidden") {
        intervals = intervals.map((interval, intervalIndex) => {
            if (intervalIndex === intervals.length - 1) {
                return 0;
            }
            return interval;
        });
    }

    if (effectiveTension <= 0.3) {
        intervals = intervals.map((interval, intervalIndex) => {
            if (intervalIndex === intervals.length - 1 || intervalIndex === 0) {
                return 0;
            }
            return clamp(interval, -4, 4);
        });
    }

    const registerBiased = applyRegisterCenterBias(intervals.slice(0, 6), registerCenter);
    const bassBiased = applyBassMotionBias(registerBiased, bassMotionProfile);
    return applySectionStyleBias(bassBiased, sectionStyle);
}

function deriveCadenceOption(
    section: SectionPlan,
    sectionIndex: number,
    totalSections: number,
    riskProfile: PlanRiskProfile | undefined,
    structureVisibility: StructureVisibility | undefined,
    tensionTarget?: number,
    rememberedCadence?: AutonomyCadenceApproachPattern,
): CadenceOption | undefined {
    const sectionCadence = normalizeCadence(section.cadence ?? section.harmonicPlan?.cadence);
    const isCadentialSection = CADENCE_ROLES.has(section.role) || sectionIndex === totalSections - 1 || Boolean(sectionCadence);
    if (!isCadentialSection) {
        return undefined;
    }

    const effectiveTension = tensionTarget ?? sectionTensionTarget(section);
    const primary = sectionCadence
        ?? rememberedCadence?.cadence
        ?? (sectionIndex === totalSections - 1
            ? (effectiveTension >= 0.68
                ? (structureVisibility === "hidden" ? "deceptive" : "half")
                : (structureVisibility === "hidden" ? "plagal" : "authentic"))
            : (effectiveTension >= 0.62 ? "open" : "half"));

    const pool = sectionIndex === totalSections - 1
        ? ["authentic", "plagal", "deceptive", "half"]
        : ["half", "open", "deceptive", "plagal"];

    let alternatives = pool.filter((cadence): cadence is CadenceStyle => cadence !== primary);
    if (effectiveTension >= 0.68) {
        alternatives = alternatives.sort((left, right) => {
            const rank = (value: CadenceStyle) => value === "deceptive" ? 0 : value === "half" ? 1 : value === "open" ? 2 : 3;
            return rank(left) - rank(right);
        });
    } else if (effectiveTension <= 0.32) {
        alternatives = alternatives.sort((left, right) => {
            const rank = (value: CadenceStyle) => value === "authentic" ? 0 : value === "plagal" ? 1 : value === "half" ? 2 : 3;
            return rank(left) - rank(right);
        });
    }

    if (riskProfile === "experimental") {
        alternatives = alternatives.sort((left, right) => {
            const leftRank = left === "deceptive" ? 0 : left === "half" ? 1 : 2;
            const rightRank = right === "deceptive" ? 0 : right === "half" ? 1 : 2;
            return leftRank - rightRank;
        });
    } else if (riskProfile === "conservative") {
        alternatives = alternatives.filter((cadence) => cadence !== "deceptive");
    }

    if (structureVisibility === "hidden") {
        alternatives = alternatives.filter((cadence) => cadence !== "authentic");
        alternatives.unshift("deceptive", "plagal");
    }

    if (rememberedCadence?.cadenceApproach === "dominant") {
        alternatives = alternatives.sort((left, right) => {
            const rank = (value: CadenceStyle) => value === "authentic" ? 0 : value === "half" ? 1 : value === "open" ? 2 : value === "plagal" ? 3 : 4;
            return rank(left) - rank(right);
        });
    } else if (rememberedCadence?.cadenceApproach === "plagal") {
        alternatives = alternatives.sort((left, right) => {
            const rank = (value: CadenceStyle) => value === "plagal" ? 0 : value === "authentic" ? 1 : value === "half" ? 2 : value === "open" ? 3 : 4;
            return rank(left) - rank(right);
        });
    } else if (rememberedCadence?.cadenceApproach === "tonic") {
        alternatives = alternatives.sort((left, right) => {
            const rank = (value: CadenceStyle) => value === "authentic" ? 0 : value === "plagal" ? 1 : value === "open" ? 2 : value === "half" ? 3 : 4;
            return rank(left) - rank(right);
        });
    }

    const memoryRationale = rememberedCadence
        ? rememberedCadence.cadenceApproach === "plagal"
            ? " Memory favors a plagal-prepared close here."
            : rememberedCadence.cadenceApproach === "dominant"
                ? " Memory favors a dominant-prepared close here."
                : rememberedCadence.cadenceApproach === "tonic"
                    ? " Memory favors a tonic-centered arrival here."
                    : " Memory favors a more deliberate close here."
        : "";

    return {
        sectionId: section.id,
        primary,
        alternatives: uniqueCadences(alternatives).filter((cadence) => cadence !== primary).slice(0, 3),
        rationale: `${section.label} keeps ${primary} available while preserving alternate exits.${memoryRationale}`,
    };
}

function mergeMotifDrafts(existing: MotifDraft[] | undefined, derived: MotifDraft[]): MotifDraft[] {
    const bySection = new Set((existing ?? []).map((draft) => draft.sectionId).filter(Boolean));
    return [
        ...(existing ?? []).map((draft) => ({ ...draft, intervals: [...draft.intervals] })),
        ...derived.filter((draft) => !draft.sectionId || !bySection.has(draft.sectionId)).map((draft) => ({ ...draft, intervals: [...draft.intervals] })),
    ];
}

function mergeCadenceOptions(existing: CadenceOption[] | undefined, derived: CadenceOption[]): CadenceOption[] {
    const bySection = new Set((existing ?? []).map((option) => option.sectionId));
    return [
        ...(existing ?? []).map((option) => ({ ...option, alternatives: [...option.alternatives] })),
        ...derived.filter((option) => !bySection.has(option.sectionId)).map((option) => ({ ...option, alternatives: [...option.alternatives] })),
    ];
}

function deriveMemoryBiasedMotifReturns(
    sections: SectionPlan[],
    motifDrafts: MotifDraft[],
    motifReturns: AutonomyMotifReturnPattern[],
): MotifDraft[] {
    if (motifReturns.length === 0) {
        return [];
    }

    const draftBySection = new Map(motifDrafts.map((draft) => [draft.sectionId, draft]));
    const added = new Set<string>();
    const derived: MotifDraft[] = [];

    for (let targetIndex = 0; targetIndex < sections.length; targetIndex += 1) {
        const targetSection = sections[targetIndex];
        if (draftBySection.has(targetSection.id) || targetSection.motifRef || added.has(targetSection.id)) {
            continue;
        }

        const matchingPattern = motifReturns.find((pattern) => pattern.targetRole === targetSection.role);
        if (!matchingPattern) {
            continue;
        }

        for (let sourceIndex = targetIndex - 1; sourceIndex >= 0; sourceIndex -= 1) {
            const sourceSection = sections[sourceIndex];
            if (sourceSection.role !== matchingPattern.sourceRole) {
                continue;
            }

            const sourceDraft = draftBySection.get(sourceSection.id);
            if (!sourceDraft) {
                continue;
            }

            derived.push({
                id: `memory-return-${targetSection.id}`,
                sectionId: targetSection.id,
                source: "pipeline",
                intervals: [...sourceDraft.intervals],
                description: `Memory-biased motif return from ${sourceSection.role} to ${targetSection.role}.`,
                preserveDuringRevision: true,
            });
            added.add(targetSection.id);
            break;
        }
    }

    return derived;
}

export function buildCompositionSketch(request: ComposeRequest): CompositionSketch | undefined {
    const plan = request.compositionPlan;
    if (!plan || plan.sections.length === 0) {
        return undefined;
    }

    const riskProfile = plan.riskProfile;
    const structureVisibility = plan.structureVisibility;
    const existing = plan.sketch;
    const memoryBias = loadSketchMemoryBias(request, plan);
    const sectionTensionBias = memoryBias.tensionArc;

    const derivedMotifs = plan.sections
        .filter((section) => MOTIF_ROLES.has(section.role))
        .map((section, index) => ({
            id: `motif-${section.id}`,
            sectionId: section.id,
            source: "pipeline" as const,
            intervals: deriveMotifIntervals(
                section,
                index,
                request,
                riskProfile,
                structureVisibility,
                sectionTensionBias?.[index],
                section.registerCenter ?? selectRegisterCenterBias(memoryBias.registerCenters, plan.form, section.role),
                selectBassMotionProfileBias(memoryBias.bassMotionProfiles, plan.form, section.role)?.bassMotionProfile,
                selectSectionStyleBias(memoryBias.sectionStyles, plan.form, section.role)?.sectionStyle,
            ),
            description: `${section.label} sketch motif for ${section.role}`,
            preserveDuringRevision: section.role === "theme_a" || section.role === "theme_b",
        }));
    const memoryMotifs = deriveMemoryBiasedMotifReturns(plan.sections, derivedMotifs, memoryBias.motifReturns);

    const derivedCadences = plan.sections
        .map((section, index) => deriveCadenceOption(
            section,
            index,
            plan.sections.length,
            riskProfile,
            structureVisibility,
            sectionTensionBias?.[index],
            selectCadenceApproachBias(memoryBias.cadenceApproaches, plan.form, section.role),
        ))
        .filter((option): option is CadenceOption => option !== undefined);
    const note = [
        existing?.note ?? `${plan.form} sketch prepared before compose to preserve motif drafts and alternate cadences.`,
        memoryBias.notes.length > 0 ? `Applied ${memoryBias.notes.join(" and ")}.` : "",
    ].filter(Boolean).join(" ");

    return {
        generatedBy: existing?.generatedBy ?? "pipeline",
        note,
        motifDrafts: mergeMotifDrafts(existing?.motifDrafts, [...derivedMotifs, ...memoryMotifs]),
        cadenceOptions: mergeCadenceOptions(existing?.cadenceOptions, derivedCadences),
    };
}

export function materializeCompositionSketch(request: ComposeRequest): ComposeRequest {
    const plan = request.compositionPlan;
    if (!plan) {
        return request;
    }

    const sketch = buildCompositionSketch(request);
    if (!sketch) {
        return request;
    }

    return {
        ...request,
        compositionPlan: {
            ...plan,
            sketch,
        },
    };
}