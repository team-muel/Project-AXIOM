import type {
    AudioLongSpanEvaluationDimension,
    AudioEvaluationReport,
    AudioLongSpanEvaluationSummary,
    LongSpanDivergenceDirectiveRecommendation,
    LongSpanDivergenceRepairMode,
    LongSpanDivergenceSummary,
    LongSpanDivergenceSectionSummary,
    LongSpanEvaluationStatus,
    LongSpanEvaluationSummary,
    SectionRole,
    StructureEvaluationReport,
    RevisionDirectiveKind,
} from "./types.js";

const LONG_SPAN_STATUS_ORDER: Record<LongSpanEvaluationStatus, number> = {
    collapsed: 0,
    at_risk: 1,
    held: 2,
};

const AUDIO_LONG_SPAN_DIRECTIVE_MAP: Record<AudioLongSpanEvaluationDimension, RevisionDirectiveKind> = {
    development_narrative: "clarify_narrative_arc",
    recap_recall: "rebalance_recap_release",
    harmonic_route: "stabilize_harmony",
    tonal_return: "rebalance_recap_release",
};

type AudioSectionFinding = NonNullable<AudioEvaluationReport["sectionFindings"]>[number];
type StructureSectionFinding = NonNullable<StructureEvaluationReport["sectionFindings"]>[number];

const LONG_SPAN_DIVERGENCE_SECTION_CONFIG: Record<AudioLongSpanEvaluationDimension, {
    roles: SectionRole[];
    maxSections: number;
    issuePrefixes: string[];
    focusMetricKeys: string[];
    consistencyMetricKeys: string[];
}> = {
    development_narrative: {
        roles: ["development", "variation", "bridge"],
        maxSections: 2,
        issuePrefixes: [
            "Audio escalation against the source section is weak.",
            "Rendered and styled audio disagree on the section's narrative contour.",
            "Rendered and styled audio disagree on the development's modulation profile.",
        ],
        focusMetricKeys: ["audioDevelopmentNarrativeFit", "audioSectionCompositeFit"],
        consistencyMetricKeys: ["audioSectionNarrativeConsistencyFit", "audioDevelopmentRouteConsistencyFit"],
    },
    recap_recall: {
        roles: ["recap", "cadence", "outro"],
        maxSections: 1,
        issuePrefixes: [
            "Audio return and release against the source section are weak.",
            "Rendered and styled audio disagree on the section's narrative contour.",
            "Rendered and styled audio disagree on the recap's tonal return.",
        ],
        focusMetricKeys: ["audioRecapRecallFit", "audioSectionCompositeFit"],
        consistencyMetricKeys: ["audioSectionNarrativeConsistencyFit", "audioRecapTonalConsistencyFit"],
    },
    harmonic_route: {
        roles: ["theme_b", "development", "variation", "recap", "cadence", "outro"],
        maxSections: 2,
        issuePrefixes: [
            "Rendered development key drift does not settle into a clear modulation path.",
            "Rendered and styled audio disagree on the development's modulation profile.",
            "Rendered pitch-class return does not settle back into the planned recap tonality.",
            "Rendered and styled audio disagree on the recap's tonal return.",
        ],
        focusMetricKeys: ["audioDevelopmentPitchClassRouteFit", "audioDevelopmentKeyDriftFit", "audioSectionCompositeFit"],
        consistencyMetricKeys: ["audioDevelopmentRouteConsistencyFit", "audioRecapTonalConsistencyFit", "audioSectionNarrativeConsistencyFit"],
    },
    tonal_return: {
        roles: ["recap", "cadence", "outro"],
        maxSections: 1,
        issuePrefixes: [
            "Rendered pitch-class return does not settle back into the planned recap tonality.",
            "Rendered and styled audio disagree on the recap's tonal return.",
            "Audio return and release against the source section are weak.",
        ],
        focusMetricKeys: ["audioRecapPitchClassReturnFit", "audioRecapRecallFit", "audioSectionCompositeFit"],
        consistencyMetricKeys: ["audioRecapTonalConsistencyFit", "audioSectionNarrativeConsistencyFit"],
    },
};

function metricValue(metrics: Record<string, number>, key: string): number | undefined {
    const value = metrics[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function mergeAudioSectionFindings(
    audioEvaluation: Pick<AudioEvaluationReport, "sectionFindings" | "weakestSections"> | undefined,
): AudioSectionFinding[] {
    const findingsById = new Map<string, AudioSectionFinding>();
    for (const finding of [...(audioEvaluation?.sectionFindings ?? []), ...(audioEvaluation?.weakestSections ?? [])]) {
        const existing = findingsById.get(finding.sectionId);
        if (!existing || finding.score < existing.score || finding.issues.length > existing.issues.length) {
            findingsById.set(finding.sectionId, finding);
        }
    }
    return Array.from(findingsById.values());
}

function mergeStructureSectionFindings(
    structureEvaluation: Pick<StructureEvaluationReport, "sectionFindings" | "weakestSections"> | undefined,
): StructureSectionFinding[] {
    const findingsById = new Map<string, StructureSectionFinding>();
    for (const finding of [...(structureEvaluation?.sectionFindings ?? []), ...(structureEvaluation?.weakestSections ?? [])]) {
        const existing = findingsById.get(finding.sectionId);
        if (!existing || finding.score < existing.score || finding.issues.length > existing.issues.length) {
            findingsById.set(finding.sectionId, finding);
        }
    }
    return Array.from(findingsById.values());
}

function issueMatchesPrefixes(issue: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => issue.startsWith(prefix));
}

function focusMetricForFinding(
    finding: AudioSectionFinding,
    focus: AudioLongSpanEvaluationDimension,
): number | undefined {
    return LONG_SPAN_DIVERGENCE_SECTION_CONFIG[focus].focusMetricKeys
        .map((key) => metricValue(finding.metrics, key))
        .find((value) => value !== undefined);
}

function consistencyMetricForFinding(
    finding: AudioSectionFinding,
    focus: AudioLongSpanEvaluationDimension,
): number | undefined {
    return LONG_SPAN_DIVERGENCE_SECTION_CONFIG[focus].consistencyMetricKeys
        .map((key) => metricValue(finding.metrics, key))
        .find((value) => value !== undefined);
}

function selectPairedStructureFinding(
    audioFinding: AudioSectionFinding,
    focus: AudioLongSpanEvaluationDimension,
    structureLongSpan: LongSpanEvaluationSummary | null | undefined,
    structureEvaluation: Pick<StructureEvaluationReport, "sectionFindings" | "weakestSections"> | undefined,
): StructureSectionFinding | undefined {
    if (!structureLongSpan || structureLongSpan.status === "held" || !structureEvaluation) {
        return undefined;
    }

    const config = LONG_SPAN_DIVERGENCE_SECTION_CONFIG[focus];
    const weakestIds = new Set((structureEvaluation.weakestSections ?? []).map((finding) => finding.sectionId));
    const candidates = mergeStructureSectionFindings(structureEvaluation)
        .filter((finding) => config.roles.includes(finding.role));

    const selected = candidates
        .sort((left, right) => (
            Number(right.sectionId === audioFinding.sectionId) - Number(left.sectionId === audioFinding.sectionId)
            || Number(right.role === audioFinding.role) - Number(left.role === audioFinding.role)
            || Number(weakestIds.has(right.sectionId)) - Number(weakestIds.has(left.sectionId))
            || left.score - right.score
            || right.issues.length - left.issues.length
            || left.startMeasure - right.startMeasure
            || left.sectionId.localeCompare(right.sectionId)
        ))[0];

    if (!selected) {
        return undefined;
    }

    return weakestIds.has(selected.sectionId) || selected.issues.length > 0
        ? selected
        : undefined;
}

function buildStructureSectionExplanation(
    audioFinding: AudioSectionFinding,
    structureFinding: StructureSectionFinding,
): string {
    const audioLabel = audioFinding.label || audioFinding.sectionId;
    const structureLabel = structureFinding.label || structureFinding.sectionId;
    const measureSpan = Number.isFinite(structureFinding.startMeasure) && Number.isFinite(structureFinding.endMeasure)
        ? ` across measures ${structureFinding.startMeasure}-${structureFinding.endMeasure}`
        : "";
    const lead = structureFinding.sectionId === audioFinding.sectionId
        ? `${audioLabel} (${audioFinding.sectionId}) is already symbolically fragile`
        : `${structureLabel} (${structureFinding.sectionId}) is already the paired symbolic weak point for ${audioLabel} (${audioFinding.sectionId})`;
    const issue = structureFinding.issues[0];
    return issue
        ? `${lead}${measureSpan}: ${issue}`
        : `${lead}${measureSpan}.`;
}

function buildSectionExplanation(
    finding: AudioSectionFinding,
    focus: AudioLongSpanEvaluationDimension,
    structureFinding?: StructureSectionFinding,
): string {
    const issue = finding.issues[0];
    const label = finding.label || finding.sectionId;
    const sourceSection = finding.sourceSectionId ? ` against ${finding.sourceSectionId}` : "";
    const tonalTarget = finding.plannedTonality ? ` toward ${finding.plannedTonality}` : "";
    const mismatchLead = `${label} (${finding.sectionId}) is the main rendered ${focusLabel(focus)} mismatch${sourceSection}${tonalTarget}`;
    if (structureFinding) {
        const audioExplanation = issue
            ? `Rendered issue: ${issue}`
            : `Rendered ${focusLabel(focus)} still falls further behind the symbolic section.`;
        return `${mismatchLead}. ${buildStructureSectionExplanation(finding, structureFinding)} ${audioExplanation}`;
    }
    if (issue) {
        return `${mismatchLead}: ${issue}`;
    }
    return `${mismatchLead}.`;
}

function summarizeLongSpanDivergenceSections(
    focus: AudioLongSpanEvaluationDimension | undefined,
    structureLongSpan: LongSpanEvaluationSummary | null | undefined,
    audioEvaluation: Pick<AudioEvaluationReport, "sectionFindings" | "weakestSections"> | undefined,
    structureEvaluation: Pick<StructureEvaluationReport, "sectionFindings" | "weakestSections"> | undefined,
): LongSpanDivergenceSectionSummary[] {
    if (!focus || !audioEvaluation) {
        return [];
    }

    const config = LONG_SPAN_DIVERGENCE_SECTION_CONFIG[focus];
    const weakestIds = new Set((audioEvaluation.weakestSections ?? []).map((finding) => finding.sectionId));
    let findings = mergeAudioSectionFindings(audioEvaluation)
        .filter((finding) => config.roles.includes(finding.role));

    const issueMatches = findings.filter((finding) => finding.issues.some((issue) => issueMatchesPrefixes(issue, config.issuePrefixes)));
    if (issueMatches.length > 0) {
        findings = issueMatches;
    }

    return findings
        .sort((left, right) => (
            Number(weakestIds.has(right.sectionId)) - Number(weakestIds.has(left.sectionId))
            || (focusMetricForFinding(left, focus) ?? 1) - (focusMetricForFinding(right, focus) ?? 1)
            || (consistencyMetricForFinding(left, focus) ?? 1) - (consistencyMetricForFinding(right, focus) ?? 1)
            || left.score - right.score
            || right.issues.length - left.issues.length
            || left.sectionId.localeCompare(right.sectionId)
        ))
        .slice(0, config.maxSections)
        .map((finding) => {
            const structureFinding = selectPairedStructureFinding(finding, focus, structureLongSpan, structureEvaluation);
            const focusFit = focusMetricForFinding(finding, focus);
            const consistencyFit = consistencyMetricForFinding(finding, focus);
            const structureExplanation = structureFinding
                ? buildStructureSectionExplanation(finding, structureFinding)
                : undefined;

            return {
                sectionId: finding.sectionId,
                label: finding.label,
                role: finding.role,
                focus,
                explanation: buildSectionExplanation(finding, focus, structureFinding),
                comparisonStatus: structureFinding ? "both_weak" : "audio_only",
                ...(finding.sourceSectionId ? { sourceSectionId: finding.sourceSectionId } : {}),
                ...(finding.plannedTonality ? { plannedTonality: finding.plannedTonality } : {}),
                ...(finding.issues[0] ? { topIssue: finding.issues[0] } : {}),
                ...(typeof finding.score === "number" ? { score: finding.score } : {}),
                ...(focusFit !== undefined ? { focusFit } : {}),
                ...(consistencyFit !== undefined ? { consistencyFit } : {}),
                ...(structureFinding ? {
                    structureSectionId: structureFinding.sectionId,
                    structureLabel: structureFinding.label,
                    structureRole: structureFinding.role,
                    structureTopIssue: structureFinding.issues[0],
                    structureScore: structureFinding.score,
                    structureStartMeasure: structureFinding.startMeasure,
                    structureEndMeasure: structureFinding.endMeasure,
                    structureExplanation,
                } : {}),
            };
        });
}

function focusLabel(focus: AudioLongSpanEvaluationDimension | undefined): string {
    switch (focus) {
        case "development_narrative":
            return "development escalation";
        case "recap_recall":
            return "recap recall";
        case "harmonic_route":
            return "harmonic route";
        case "tonal_return":
            return "tonal return";
        default:
            return "rendered long-span arc";
    }
}

function buildLongSpanDivergenceExplanation(
    status: LongSpanDivergenceSummary["status"],
    structureStatus: LongSpanEvaluationStatus,
    focus: AudioLongSpanEvaluationDimension | undefined,
): string {
    const structureLead = structureStatus === "held"
        ? "Symbolic long-span form held"
        : "Symbolic long-span form remained more stable than the render";

    switch (focus) {
        case "development_narrative":
            return status === "render_collapsed"
                ? `${structureLead}, but rendered development collapses the planned escalation.`
                : `Rendered development underplays the symbolic long-span escalation.`;
        case "recap_recall":
            return status === "render_collapsed"
                ? `${structureLead}, but rendered recap recall collapses the planned return payoff.`
                : `Rendered recap recall is weaker than the symbolic long-span return.`;
        case "harmonic_route":
            return status === "render_collapsed"
                ? `${structureLead}, but rendered harmonic route collapses the planned return path.`
                : `Rendered harmonic route is weaker than the symbolic long-span route.`;
        case "tonal_return":
            return status === "render_collapsed"
                ? `${structureLead}, but rendered tonal return collapses the planned recap payoff.`
                : `Rendered tonal return is weaker than the symbolic long-span return.`;
        default:
            return status === "render_collapsed"
                ? `${structureLead}, but the rendered long-span arc collapses.`
                : `Rendered long-span shaping is weaker than the symbolic plan.`;
    }
}

function deriveLongSpanDivergenceRepairMode(
    sections: LongSpanDivergenceSectionSummary[],
): LongSpanDivergenceRepairMode {
    if (sections.some((section) => (
        section.comparisonStatus === "both_weak"
        && typeof section.structureSectionId === "string"
        && section.structureSectionId.length > 0
        && section.structureSectionId !== section.sectionId
    ))) {
        return "paired_cross_section";
    }

    if (sections.some((section) => section.comparisonStatus === "both_weak")) {
        return "paired_same_section";
    }

    return "render_only";
}

export function recommendedDirectiveForAudioLongSpanDimension(
    dimension: AudioLongSpanEvaluationDimension | undefined,
): RevisionDirectiveKind | undefined {
    return dimension ? AUDIO_LONG_SPAN_DIRECTIVE_MAP[dimension] : undefined;
}

function buildLongSpanDivergenceDirectiveRecommendations(
    repairFocus: AudioLongSpanEvaluationDimension | undefined,
    secondaryRepairFocuses: AudioLongSpanEvaluationDimension[],
): LongSpanDivergenceDirectiveRecommendation[] {
    const orderedFocuses = repairFocus
        ? [repairFocus, ...secondaryRepairFocuses]
        : secondaryRepairFocuses.slice();

    return orderedFocuses.flatMap((focus, index) => {
        const kind = recommendedDirectiveForAudioLongSpanDimension(focus);
        return kind ? [{
            focus,
            kind,
            priorityClass: index === 0 ? "primary" : "secondary",
        }] : [];
    });
}

export function summarizeLongSpanDivergence(
    structureLongSpan: LongSpanEvaluationSummary | null | undefined,
    audioLongSpan: AudioLongSpanEvaluationSummary | null | undefined,
    audioEvaluation?: Pick<AudioEvaluationReport, "sectionFindings" | "weakestSections">,
    structureEvaluation?: Pick<StructureEvaluationReport, "sectionFindings" | "weakestSections">,
): LongSpanDivergenceSummary | undefined {
    if (!structureLongSpan || !audioLongSpan) {
        return undefined;
    }

    const structureRank = LONG_SPAN_STATUS_ORDER[structureLongSpan.status];
    const audioRank = LONG_SPAN_STATUS_ORDER[audioLongSpan.status];
    if (audioRank >= structureRank) {
        return undefined;
    }

    const repairFocus = audioLongSpan.weakestDimension ?? audioLongSpan.weakDimensions[0];
    const secondaryRepairFocuses = audioLongSpan.weakDimensions.filter((dimension) => dimension !== repairFocus);
    const recommendedDirectiveKind = recommendedDirectiveForAudioLongSpanDimension(repairFocus);
    const recommendedDirectives = buildLongSpanDivergenceDirectiveRecommendations(repairFocus, secondaryRepairFocuses);
    const averageFitGap = typeof structureLongSpan.averageFit === "number" && typeof audioLongSpan.averageFit === "number"
        ? Number((structureLongSpan.averageFit - audioLongSpan.averageFit).toFixed(4))
        : undefined;
    const status: LongSpanDivergenceSummary["status"] = audioLongSpan.status === "collapsed"
        ? "render_collapsed"
        : "render_weaker";
    const sections = summarizeLongSpanDivergenceSections(repairFocus, structureLongSpan, audioEvaluation, structureEvaluation);
    const repairMode = deriveLongSpanDivergenceRepairMode(sections);

    return {
        status,
        explanation: buildLongSpanDivergenceExplanation(status, structureLongSpan.status, repairFocus),
        repairMode,
        structureStatus: structureLongSpan.status,
        audioStatus: audioLongSpan.status,
        ...(structureLongSpan.weakestDimension ? { structureWeakestDimension: structureLongSpan.weakestDimension } : {}),
        ...(audioLongSpan.weakestDimension ? { audioWeakestDimension: audioLongSpan.weakestDimension } : {}),
        ...(repairFocus ? { repairFocus } : {}),
        ...(secondaryRepairFocuses.length > 0 ? { secondaryRepairFocuses } : {}),
        ...(recommendedDirectiveKind ? { recommendedDirectiveKind } : {}),
        ...(recommendedDirectives.length > 0 ? { recommendedDirectives } : {}),
        ...(sections[0]?.sectionId ? { primarySectionId: sections[0].sectionId } : {}),
        ...(sections[0]?.role ? { primarySectionRole: sections[0].role } : {}),
        ...(typeof structureLongSpan.averageFit === "number" ? { structureAverageFit: structureLongSpan.averageFit } : {}),
        ...(typeof audioLongSpan.averageFit === "number" ? { audioAverageFit: audioLongSpan.averageFit } : {}),
        ...(averageFitGap !== undefined ? { averageFitGap } : {}),
        ...(sections.length > 0 ? { sections } : {}),
    };
}

export function summarizeLongSpanDivergenceLabel(
    summary: LongSpanDivergenceSummary | null | undefined,
): string {
    if (!summary?.status) {
        return "-";
    }

    return summary.repairFocus
        ? `${summary.status}:${summary.repairFocus}`
        : summary.status;
}