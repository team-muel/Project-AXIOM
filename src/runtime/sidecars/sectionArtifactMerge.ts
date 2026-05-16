import type {
    SectionArtifactSummary,
    SectionHarmonicRealizationSummary,
    SectionOrnamentSummary,
    SectionPhraseBreathSummary,
    SectionTempoMotionSummary,
} from "../../core/pipeline/types.js";

export function mergeSectionPhraseBreathSummaries(
    sectionArtifacts: SectionArtifactSummary[] | undefined,
    summaries: SectionPhraseBreathSummary[] | undefined,
): SectionArtifactSummary[] | undefined {
    if (!sectionArtifacts?.length || !summaries?.length) {
        return sectionArtifacts;
    }

    const summaryBySectionId = new Map(summaries.map((summary) => [summary.sectionId, summary]));
    return sectionArtifacts.map((artifact) => {
        const summary = summaryBySectionId.get(artifact.sectionId);
        if (!summary) {
            return artifact;
        }

        return {
            ...artifact,
            phraseBreathSummary: {
                requestedCues: [...summary.requestedCues],
                targetedMeasureCount: summary.targetedMeasureCount,
                realizedMeasureCount: summary.realizedMeasureCount,
                realizedNoteCount: summary.realizedNoteCount,
                ...(summary.averageDurationScale !== undefined ? { averageDurationScale: summary.averageDurationScale } : {}),
                ...(summary.averageTimingJitterScale !== undefined ? { averageTimingJitterScale: summary.averageTimingJitterScale } : {}),
                ...(summary.averageEndingStretchScale !== undefined ? { averageEndingStretchScale: summary.averageEndingStretchScale } : {}),
                ...(summary.peakDurationScaleDelta !== undefined ? { peakDurationScaleDelta: summary.peakDurationScaleDelta } : {}),
                ...(summary.pickupMeasureCount !== undefined ? { pickupMeasureCount: summary.pickupMeasureCount } : {}),
                ...(summary.pickupAverageDurationScale !== undefined ? { pickupAverageDurationScale: summary.pickupAverageDurationScale } : {}),
                ...(summary.pickupAverageTimingJitterScale !== undefined ? { pickupAverageTimingJitterScale: summary.pickupAverageTimingJitterScale } : {}),
                ...(summary.pickupAverageEndingStretchScale !== undefined ? { pickupAverageEndingStretchScale: summary.pickupAverageEndingStretchScale } : {}),
                ...(summary.arrivalMeasureCount !== undefined ? { arrivalMeasureCount: summary.arrivalMeasureCount } : {}),
                ...(summary.arrivalAverageDurationScale !== undefined ? { arrivalAverageDurationScale: summary.arrivalAverageDurationScale } : {}),
                ...(summary.arrivalAverageTimingJitterScale !== undefined ? { arrivalAverageTimingJitterScale: summary.arrivalAverageTimingJitterScale } : {}),
                ...(summary.arrivalAverageEndingStretchScale !== undefined ? { arrivalAverageEndingStretchScale: summary.arrivalAverageEndingStretchScale } : {}),
                ...(summary.releaseMeasureCount !== undefined ? { releaseMeasureCount: summary.releaseMeasureCount } : {}),
                ...(summary.releaseAverageDurationScale !== undefined ? { releaseAverageDurationScale: summary.releaseAverageDurationScale } : {}),
                ...(summary.releaseAverageTimingJitterScale !== undefined ? { releaseAverageTimingJitterScale: summary.releaseAverageTimingJitterScale } : {}),
                ...(summary.releaseAverageEndingStretchScale !== undefined ? { releaseAverageEndingStretchScale: summary.releaseAverageEndingStretchScale } : {}),
                ...(summary.cadenceRecoveryMeasureCount !== undefined ? { cadenceRecoveryMeasureCount: summary.cadenceRecoveryMeasureCount } : {}),
                ...(summary.cadenceRecoveryAverageDurationScale !== undefined ? { cadenceRecoveryAverageDurationScale: summary.cadenceRecoveryAverageDurationScale } : {}),
                ...(summary.cadenceRecoveryAverageTimingJitterScale !== undefined ? { cadenceRecoveryAverageTimingJitterScale: summary.cadenceRecoveryAverageTimingJitterScale } : {}),
                ...(summary.cadenceRecoveryAverageEndingStretchScale !== undefined ? { cadenceRecoveryAverageEndingStretchScale: summary.cadenceRecoveryAverageEndingStretchScale } : {}),
                ...(summary.rubatoAnchorCount !== undefined ? { rubatoAnchorCount: summary.rubatoAnchorCount } : {}),
                ...(summary.rubatoAnchorAverageDurationScale !== undefined ? { rubatoAnchorAverageDurationScale: summary.rubatoAnchorAverageDurationScale } : {}),
                ...(summary.rubatoAnchorAverageTimingJitterScale !== undefined ? { rubatoAnchorAverageTimingJitterScale: summary.rubatoAnchorAverageTimingJitterScale } : {}),
                ...(summary.rubatoAnchorAverageEndingStretchScale !== undefined ? { rubatoAnchorAverageEndingStretchScale: summary.rubatoAnchorAverageEndingStretchScale } : {}),
            },
        };
    });
}

export function mergeSectionHarmonicRealizationSummaries(
    sectionArtifacts: SectionArtifactSummary[] | undefined,
    summaries: SectionHarmonicRealizationSummary[] | undefined,
): SectionArtifactSummary[] | undefined {
    if (!sectionArtifacts?.length || !summaries?.length) {
        return sectionArtifacts;
    }

    const summaryBySectionId = new Map(summaries.map((summary) => [summary.sectionId, summary]));
    return sectionArtifacts.map((artifact) => {
        const summary = summaryBySectionId.get(artifact.sectionId);
        if (!summary) {
            return artifact;
        }

        return {
            ...artifact,
            harmonicRealizationSummary: {
                ...(summary.prolongationMode ? { prolongationMode: summary.prolongationMode } : {}),
                ...(summary.requestedTonicizationTargets?.length ? { requestedTonicizationTargets: [...summary.requestedTonicizationTargets] } : {}),
                ...(summary.requestedColorTags?.length ? { requestedColorTags: [...summary.requestedColorTags] } : {}),
                targetedMeasureCount: summary.targetedMeasureCount,
                realizedMeasureCount: summary.realizedMeasureCount,
                realizedNoteCount: summary.realizedNoteCount,
                ...(summary.averageDurationScale !== undefined ? { averageDurationScale: summary.averageDurationScale } : {}),
                ...(summary.averageTimingJitterScale !== undefined ? { averageTimingJitterScale: summary.averageTimingJitterScale } : {}),
                ...(summary.averageEndingStretchScale !== undefined ? { averageEndingStretchScale: summary.averageEndingStretchScale } : {}),
                ...(summary.peakDurationScaleDelta !== undefined ? { peakDurationScaleDelta: summary.peakDurationScaleDelta } : {}),
                ...(summary.prolongationMeasureCount !== undefined ? { prolongationMeasureCount: summary.prolongationMeasureCount } : {}),
                ...(summary.prolongationAverageDurationScale !== undefined ? { prolongationAverageDurationScale: summary.prolongationAverageDurationScale } : {}),
                ...(summary.prolongationAverageTimingJitterScale !== undefined ? { prolongationAverageTimingJitterScale: summary.prolongationAverageTimingJitterScale } : {}),
                ...(summary.prolongationAverageEndingStretchScale !== undefined ? { prolongationAverageEndingStretchScale: summary.prolongationAverageEndingStretchScale } : {}),
                ...(summary.tonicizationMeasureCount !== undefined ? { tonicizationMeasureCount: summary.tonicizationMeasureCount } : {}),
                ...(summary.tonicizationAverageDurationScale !== undefined ? { tonicizationAverageDurationScale: summary.tonicizationAverageDurationScale } : {}),
                ...(summary.tonicizationAverageTimingJitterScale !== undefined ? { tonicizationAverageTimingJitterScale: summary.tonicizationAverageTimingJitterScale } : {}),
                ...(summary.tonicizationAverageEndingStretchScale !== undefined ? { tonicizationAverageEndingStretchScale: summary.tonicizationAverageEndingStretchScale } : {}),
                ...(summary.harmonicColorMeasureCount !== undefined ? { harmonicColorMeasureCount: summary.harmonicColorMeasureCount } : {}),
                ...(summary.harmonicColorAverageDurationScale !== undefined ? { harmonicColorAverageDurationScale: summary.harmonicColorAverageDurationScale } : {}),
                ...(summary.harmonicColorAverageTimingJitterScale !== undefined ? { harmonicColorAverageTimingJitterScale: summary.harmonicColorAverageTimingJitterScale } : {}),
                ...(summary.harmonicColorAverageEndingStretchScale !== undefined ? { harmonicColorAverageEndingStretchScale: summary.harmonicColorAverageEndingStretchScale } : {}),
            },
        };
    });
}

export function mergeSectionTempoMotionSummaries(
    sectionArtifacts: SectionArtifactSummary[] | undefined,
    summaries: SectionTempoMotionSummary[] | undefined,
): SectionArtifactSummary[] | undefined {
    if (!sectionArtifacts?.length || !summaries?.length) {
        return sectionArtifacts;
    }

    const summaryBySectionId = new Map(summaries.map((summary) => [summary.sectionId, summary]));
    return sectionArtifacts.map((artifact) => {
        const summary = summaryBySectionId.get(artifact.sectionId);
        if (!summary) {
            return artifact;
        }

        return {
            ...artifact,
            tempoMotionSummary: {
                requestedTags: [...summary.requestedTags],
                targetedMeasureCount: summary.targetedMeasureCount,
                realizedMeasureCount: summary.realizedMeasureCount,
                realizedNoteCount: summary.realizedNoteCount,
                ...(summary.averageDurationScale !== undefined ? { averageDurationScale: summary.averageDurationScale } : {}),
                ...(summary.averageTimingJitterScale !== undefined ? { averageTimingJitterScale: summary.averageTimingJitterScale } : {}),
                ...(summary.averageEndingStretchScale !== undefined ? { averageEndingStretchScale: summary.averageEndingStretchScale } : {}),
                ...(summary.peakDurationScaleDelta !== undefined ? { peakDurationScaleDelta: summary.peakDurationScaleDelta } : {}),
                ...(summary.motionDirection ? { motionDirection: summary.motionDirection } : {}),
            },
        };
    });
}

export function mergeSectionOrnamentSummaries(
    sectionArtifacts: SectionArtifactSummary[] | undefined,
    summaries: SectionOrnamentSummary[] | undefined,
): SectionArtifactSummary[] | undefined {
    if (!sectionArtifacts?.length || !summaries?.length) {
        return sectionArtifacts;
    }

    const summaryBySectionId = new Map(summaries.map((summary) => [summary.sectionId, summary]));
    return sectionArtifacts.map((artifact) => {
        const summary = summaryBySectionId.get(artifact.sectionId);
        if (!summary) {
            return artifact;
        }

        return {
            ...artifact,
            ornamentSummary: {
                requestedTags: [...summary.requestedTags],
                explicitlyRealizedTags: [...summary.explicitlyRealizedTags],
                ...(summary.unsupportedTags?.length ? { unsupportedTags: [...summary.unsupportedTags] } : {}),
                targetedEventCount: summary.targetedEventCount,
                realizedEventCount: summary.realizedEventCount,
                realizedNoteCount: summary.realizedNoteCount,
                ...(summary.averageDurationScale !== undefined ? { averageDurationScale: summary.averageDurationScale } : {}),
                ...(summary.averageTimingJitterScale !== undefined ? { averageTimingJitterScale: summary.averageTimingJitterScale } : {}),
                ...(summary.averageEndingStretchScale !== undefined ? { averageEndingStretchScale: summary.averageEndingStretchScale } : {}),
                ...(summary.averageOnsetSpreadBeats !== undefined ? { averageOnsetSpreadBeats: summary.averageOnsetSpreadBeats } : {}),
                ...(summary.peakOnsetSpreadBeats !== undefined ? { peakOnsetSpreadBeats: summary.peakOnsetSpreadBeats } : {}),
                ...(summary.averageGraceLeadInBeats !== undefined ? { averageGraceLeadInBeats: summary.averageGraceLeadInBeats } : {}),
                ...(summary.peakGraceLeadInBeats !== undefined ? { peakGraceLeadInBeats: summary.peakGraceLeadInBeats } : {}),
                ...(summary.averageTrillOscillationCount !== undefined ? { averageTrillOscillationCount: summary.averageTrillOscillationCount } : {}),
                ...(summary.peakTrillOscillationCount !== undefined ? { peakTrillOscillationCount: summary.peakTrillOscillationCount } : {}),
                ...(summary.averageTrillSpanBeats !== undefined ? { averageTrillSpanBeats: summary.averageTrillSpanBeats } : {}),
                ...(summary.peakTrillSpanBeats !== undefined ? { peakTrillSpanBeats: summary.peakTrillSpanBeats } : {}),
                ...(summary.peakDurationScaleDelta !== undefined ? { peakDurationScaleDelta: summary.peakDurationScaleDelta } : {}),
            },
        };
    });
}
