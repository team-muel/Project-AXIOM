import test from "node:test";
import assert from "node:assert/strict";
import { critique } from "../dist/critic/index.js";
import { buildStructureEvaluation } from "../dist/pipeline/evaluation.js";

function encodeVarLen(value) {
    let buffer = value & 0x7f;
    const bytes = [];

    while ((value >>= 7) > 0) {
        buffer <<= 8;
        buffer |= (value & 0x7f) | 0x80;
    }

    while (true) {
        bytes.push(buffer & 0xff);
        if (buffer & 0x80) {
            buffer >>= 8;
        } else {
            break;
        }
    }

    return bytes;
}

function buildMonophonicMidi(sequence, ticksPerQuarter = 480) {
    const track = [];

    for (const item of sequence) {
        const deltaBefore = item.deltaBefore ?? 0;
        track.push(...encodeVarLen(deltaBefore), 0x90, item.pitch, item.velocity ?? 88);
        track.push(...encodeVarLen(item.durationTicks), 0x80, item.pitch, 0x40);
    }

    track.push(0x00, 0xff, 0x2f, 0x00);

    const trackBuffer = Buffer.from(track);
    const header = Buffer.from([
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00,
        0x00, 0x01,
        (ticksPerQuarter >> 8) & 0xff,
        ticksPerQuarter & 0xff,
    ]);
    const trackHeader = Buffer.from([
        0x4d, 0x54, 0x72, 0x6b,
        (trackBuffer.length >> 24) & 0xff,
        (trackBuffer.length >> 16) & 0xff,
        (trackBuffer.length >> 8) & 0xff,
        trackBuffer.length & 0xff,
    ]);

    return Buffer.concat([header, trackHeader, trackBuffer]);
}

function buildMultiTrackMidi(tracks, ticksPerQuarter = 480) {
    const header = Buffer.from([
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x01,
        (tracks.length >> 8) & 0xff,
        tracks.length & 0xff,
        (ticksPerQuarter >> 8) & 0xff,
        ticksPerQuarter & 0xff,
    ]);

    const trackBuffers = tracks.map((sequence) => {
        const track = [];
        for (const item of sequence) {
            const deltaBefore = item.deltaBefore ?? 0;
            track.push(...encodeVarLen(deltaBefore), 0x90, item.pitch, item.velocity ?? 88);
            track.push(...encodeVarLen(item.durationTicks), 0x80, item.pitch, 0x40);
        }

        track.push(0x00, 0xff, 0x2f, 0x00);
        const trackBuffer = Buffer.from(track);
        const trackHeader = Buffer.from([
            0x4d, 0x54, 0x72, 0x6b,
            (trackBuffer.length >> 24) & 0xff,
            (trackBuffer.length >> 16) & 0xff,
            (trackBuffer.length >> 8) & 0xff,
            trackBuffer.length & 0xff,
        ]);

        return Buffer.concat([trackHeader, trackBuffer]);
    });

    return Buffer.concat([header, ...trackBuffers]);
}

test("passes balanced cadential melody in C major", async () => {
    const midi = buildMonophonicMidi([
        { pitch: 60, durationTicks: 480 },
        { pitch: 62, durationTicks: 480 },
        { pitch: 64, durationTicks: 240 },
        { pitch: 67, durationTicks: 240 },
        { pitch: 69, durationTicks: 480 },
        { pitch: 67, durationTicks: 240 },
        { pitch: 64, durationTicks: 240 },
        { pitch: 62, durationTicks: 480 },
        { pitch: 60, durationTicks: 960 },
    ]);

    const result = await critique(midi, "balanced-song", "C major");
    assert.equal(result.pass, true);
    assert.deepEqual(result.issues, []);
});

test("rejects repetitive line with weak cadence", async () => {
    const midi = buildMonophonicMidi([
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 62, durationTicks: 480 },
    ]);

    const result = await critique(midi, "repetitive-song", "C major");
    assert.equal(result.pass, false);
    assert.match(result.issues.join(" | "), /Excessive repetition/);
    assert.match(result.issues.join(" | "), /Limited pitch-class variety/);
    assert.match(result.issues.join(" | "), /Final melodic note does not resolve/);
});

test("rejects melody with too many unresolved wide leaps", async () => {
    const midi = buildMonophonicMidi([
        { pitch: 60, durationTicks: 480 },
        { pitch: 79, durationTicks: 480 },
        { pitch: 62, durationTicks: 480 },
        { pitch: 81, durationTicks: 480 },
        { pitch: 64, durationTicks: 480 },
        { pitch: 83, durationTicks: 480 },
        { pitch: 65, durationTicks: 480 },
        { pitch: 84, durationTicks: 480 },
        { pitch: 62, durationTicks: 960 },
    ]);

    const result = await critique(midi, "leaping-song", "C major");
    assert.equal(result.pass, false);
    assert.match(result.issues.join(" | "), /Too many wide leaps/);
    assert.match(result.issues.join(" | "), /Large leaps are not balanced/);
});

test("critique reports weakest sections without changing top-level pass behavior", async () => {
    const midi = buildMonophonicMidi([
        { pitch: 60, durationTicks: 960 },
        { pitch: 62, durationTicks: 480 },
        { pitch: 64, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 64, durationTicks: 480 },
        { pitch: 60, durationTicks: 960 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 60, durationTicks: 480 },
    ]);

    const result = await critique(midi, "section-song", {
        key: "C major",
        meter: "4/4",
        sections: [
            { id: "s1", role: "theme_a", label: "Opening", measures: 2 },
            { id: "s2", role: "cadence", label: "Close", measures: 2, cadence: "authentic" },
        ],
    });

    assert.equal(result.pass, true);
    assert.equal(result.sectionFindings?.length, 2);
    assert.equal(result.weakestSections?.[0]?.sectionId, "s2");
    assert.match(result.weakestSections?.[0]?.issues.join(" | ") ?? "", /Limited local pitch variety/);
    assert.equal(result.metrics?.sectionCount, 2);
    assert.equal(result.metrics?.weakSectionCount, 1);
});

test("buildStructureEvaluation preserves section findings from critique", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        issues: [],
        score: 86,
        strengths: ["Global checks passed."],
        metrics: { issueCount: 0 },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 2,
                score: 84,
                issues: [],
                strengths: ["Carries a stable local idea."],
                metrics: { noteCount: 6 },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 3,
                endMeasure: 4,
                score: 61,
                issues: ["Limited local pitch variety: 2 pitch classes"],
                strengths: [],
                metrics: { noteCount: 8 },
            },
        ],
    });

    assert.equal(evaluation.sectionFindings?.[0]?.sectionId, "s1");
    assert.equal(evaluation.weakestSections?.[0]?.sectionId, "s2");
    assert.equal(evaluation.weakestSections?.[0]?.metrics.noteCount, 8);
});

test("buildStructureEvaluation derives compact long-span operator status from structure metrics", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        issues: [],
        score: 88,
        strengths: ["Global checks passed."],
        metrics: {
            longSpanDevelopmentPressureFit: 0.71,
            longSpanThematicTransformationFit: 0.63,
            longSpanHarmonicTimingFit: 0.4,
            longSpanReturnPayoffFit: 0.43,
        },
    }, {
        longSpanForm: {
            expositionStartSectionId: "s1",
            developmentStartSectionId: "s3",
            recapStartSectionId: "s5",
            returnSectionId: "s5",
            delayedPayoffSectionId: "s5",
            expectedDevelopmentPressure: "high",
            expectedReturnPayoff: "inevitable",
            thematicCheckpoints: [
                { sourceSectionId: "s1", targetSectionId: "s3", transform: "fragment", preserveIdentity: true },
                { sourceSectionId: "s1", targetSectionId: "s5", transform: "repeat", preserveIdentity: true },
            ],
        },
    });

    assert.equal(evaluation.longSpan?.status, "collapsed");
    assert.equal(evaluation.longSpan?.weakestDimension, "harmonic_timing");
    assert.deepEqual(evaluation.longSpan?.weakDimensions, ["harmonic_timing", "return_payoff"]);
    assert.equal(evaluation.longSpan?.expectedReturnPayoff, "inevitable");
    assert.equal(evaluation.longSpan?.thematicCheckpointCount, 2);
    assert.equal(evaluation.longSpan?.harmonicTimingFit, 0.4);
});

test("buildStructureEvaluation lowers global score when one weak section is far behind the rest", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        issues: [],
        score: 84,
        strengths: ["Global checks passed."],
        metrics: { issueCount: 0 },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 2,
                score: 88,
                issues: [],
                strengths: ["Carries the main idea clearly."],
                metrics: { noteCount: 8 },
            },
        ],
        weakestSections: [
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 3,
                endMeasure: 4,
                score: 60,
                issues: ["Limited local pitch variety: 2 pitch classes"],
                strengths: [],
                metrics: { noteCount: 6 },
            },
        ],
    });

    assert.equal(evaluation.metrics?.sectionMinimumScore, 60);
    assert.ok((evaluation.metrics?.sectionAverageScore ?? 0) < 76);
    assert.ok((evaluation.metrics?.sectionScoreSpread ?? 0) >= 28);
    assert.ok((evaluation.metrics?.sectionReliabilityPenalty ?? 0) >= 6);
    assert.match(evaluation.issues.join(" | "), /At least one section is materially weaker than the rest of the form/);
    assert.match(evaluation.issues.join(" | "), /Section quality varies too sharply across the form/);
    assert.ok((evaluation.score ?? 0) < 78);
});

test("buildStructureEvaluation enriches section findings with artifact-aware register and cadence diagnostics", () => {
    const evaluation = buildStructureEvaluation({
        pass: true,
        issues: [],
        score: 88,
        strengths: ["Global checks passed."],
        metrics: { issueCount: 0 },
        sectionFindings: [
            {
                sectionId: "s1",
                label: "Opening",
                role: "theme_a",
                startMeasure: 1,
                endMeasure: 4,
                score: 86,
                issues: [],
                strengths: [],
                metrics: {},
            },
            {
                sectionId: "s2",
                label: "Close",
                role: "cadence",
                startMeasure: 5,
                endMeasure: 8,
                score: 84,
                issues: [],
                strengths: [],
                metrics: {},
            },
        ],
    }, {
        sections: [
            { id: "s1", role: "theme_a", label: "Opening", measures: 4, energy: 0.42, density: 0.34, registerCenter: 52 },
            {
                id: "s2",
                role: "cadence",
                label: "Close",
                measures: 4,
                energy: 0.28,
                density: 0.24,
                registerCenter: 60,
                harmonicPlan: { cadence: "authentic", tonalCenter: "C major", allowModulation: false },
            },
        ],
        sectionArtifacts: [
            {
                sectionId: "s1",
                role: "theme_a",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                plannedRegisterCenter: 52,
                realizedRegisterCenter: 66,
            },
            {
                sectionId: "s2",
                role: "cadence",
                measureCount: 4,
                melodyEvents: [],
                accompanimentEvents: [],
                noteHistory: [],
                plannedRegisterCenter: 60,
                realizedRegisterCenter: 61,
                cadenceApproach: "other",
            },
        ],
    });

    const opening = evaluation.sectionFindings?.find((finding) => finding.sectionId === "s1");
    const close = evaluation.sectionFindings?.find((finding) => finding.sectionId === "s2");

    assert.ok(opening && close);
    assert.match(opening.issues.join(" | "), /Realized register center drifts from planned register target/);
    assert.equal(opening.metrics.registerCenterDrift, 14);
    assert.ok((opening.metrics.registerCenterFit ?? 1) < 0.3);
    assert.match(close.issues.join(" | "), /Cadence approach in the bass does not align with the planned close/);
    assert.ok((close.metrics.cadenceApproachFit ?? 1) < 0.2);
    assert.ok((evaluation.metrics?.registerPlanFit ?? 1) < 0.7);
    assert.ok((evaluation.metrics?.cadenceApproachPlanFit ?? 1) < 0.6);
    assert.match(evaluation.issues.join(" | "), /Register planning drifts from the intended section targets/);
    assert.match(evaluation.issues.join(" | "), /Bass cadence approach does not match the planned sectional closes/);
    assert.ok((evaluation.score ?? 0) < 80);
    assert.equal(evaluation.weakestSections?.[0]?.sectionId, "s2");
});

test("critique flags section tension-arc mismatch against planned contour", async () => {
    const midi = buildMonophonicMidi([
        { pitch: 60, durationTicks: 960 },
        { pitch: 60, durationTicks: 960 },
        { pitch: 60, durationTicks: 960 },
        { pitch: 60, durationTicks: 960 },
        { pitch: 60, durationTicks: 480 },
        { pitch: 79, durationTicks: 480 },
        { pitch: 62, durationTicks: 480 },
        { pitch: 81, durationTicks: 480 },
        { pitch: 64, durationTicks: 480 },
        { pitch: 83, durationTicks: 480 },
        { pitch: 65, durationTicks: 480 },
        { pitch: 84, durationTicks: 480 },
    ]);

    const result = await critique(midi, "tension-song", {
        key: "C major",
        meter: "4/4",
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Pressure build",
                measures: 2,
                energy: 0.9,
                density: 0.7,
                harmonicPlan: { tensionTarget: 0.9 },
            },
            {
                id: "s2",
                role: "cadence",
                label: "Release",
                measures: 2,
                cadence: "authentic",
                energy: 0.2,
                density: 0.2,
                harmonicPlan: { tensionTarget: 0.15 },
            },
        ],
    });

    assert.equal(result.sectionFindings?.length, 2);
    assert.match(result.sectionFindings?.[0]?.issues.join(" | ") ?? "", /Tension arc mismatch/);
    assert.match(result.sectionFindings?.[1]?.issues.join(" | ") ?? "", /Tension arc mismatch/);
    assert.ok((result.metrics?.tensionArcMismatch ?? 0) >= 0.24);
    assert.match(result.issues.join(" | "), /Section tension arc diverges/);
});

test("critique respects a planned local tonal center for the closing cadence", async () => {
    const midi = buildMonophonicMidi([
        { pitch: 67, durationTicks: 480 },
        { pitch: 69, durationTicks: 480 },
        { pitch: 71, durationTicks: 240 },
        { pitch: 74, durationTicks: 240 },
        { pitch: 71, durationTicks: 480 },
        { pitch: 69, durationTicks: 240 },
        { pitch: 67, durationTicks: 240 },
        { pitch: 62, durationTicks: 960 },
    ]);

    const result = await critique(midi, "modulating-close", {
        key: "C major",
        meter: "4/4",
        sections: [
            {
                id: "s1",
                role: "cadence",
                label: "G-major close",
                measures: 2,
                cadence: "authentic",
                energy: 0.35,
                density: 0.35,
                harmonicPlan: {
                    tonalCenter: "G major",
                    allowModulation: true,
                    cadence: "authentic",
                },
            },
        ],
    });

    assert.equal(result.pass, true);
    assert.equal(result.sectionFindings?.[0]?.metrics.cadenceResolved, 1);
    assert.doesNotMatch(result.sectionFindings?.[0]?.issues.join(" | ") ?? "", /does not settle convincingly/);
    assert.match(result.strengths.join(" | "), /G major/);
});

test("critique reports strong development and recap narrative metrics when sections transform and recall a theme", async () => {
    const durations = [480, 240, 240, 480, 480, 240, 240, 480, 960];
    const theme = [60, 62, 64, 65, 64, 62, 60, 67, 64];
    const development = [62, 60, 59, 55, 59, 60, 62, 69, 67];
    const recap = [60, 62, 64, 65, 64, 62, 60, 67, 60];
    const midi = buildMonophonicMidi(
        [...theme, ...development, ...recap].map((pitch, index) => ({
            pitch,
            durationTicks: durations[index % durations.length],
        })),
    );

    const result = await critique(midi, "narrative-strong", {
        key: "C major",
        meter: "4/4",
        sections: [
            { id: "s1", role: "theme_a", label: "Theme", measures: 2, energy: 0.35, density: 0.35 },
            { id: "s2", role: "development", label: "Development", measures: 2, energy: 0.68, density: 0.58, motifRef: "s1" },
            { id: "s3", role: "recap", label: "Recap", measures: 2, energy: 0.32, density: 0.34, motifRef: "s1", cadence: "authentic" },
        ],
        longSpanForm: {
            expositionStartSectionId: "s1",
            developmentStartSectionId: "s2",
            recapStartSectionId: "s3",
            returnSectionId: "s3",
            expectedDevelopmentPressure: "high",
            expectedReturnPayoff: "clear",
            thematicCheckpoints: [
                { sourceSectionId: "s1", targetSectionId: "s2", transform: "fragment", preserveIdentity: true },
                { sourceSectionId: "s1", targetSectionId: "s3", transform: "repeat", preserveIdentity: true },
            ],
        },
    });

    assert.ok((result.metrics?.developmentNarrativeFit ?? 0) >= 0.62);
    assert.ok((result.metrics?.recapRecallFit ?? 0) >= 0.68);
    assert.ok((result.metrics?.longSpanDevelopmentPressureFit ?? 0) >= 0.45);
    assert.ok((result.metrics?.longSpanThematicTransformationFit ?? 0) >= 0.6);
    assert.ok((result.metrics?.longSpanReturnPayoffFit ?? 0) >= 0.68);
    assert.match(result.strengths.join(" | "), /Development meaningfully transforms earlier thematic material/);
    assert.match(result.strengths.join(" | "), /Recap clearly recalls earlier thematic material/);
});

test("critique flags recap sections that fail to recall the earlier theme", async () => {
    const durations = [480, 240, 240, 480, 480, 240, 240, 480, 960];
    const theme = [60, 62, 64, 65, 64, 62, 60, 67, 64];
    const development = [62, 60, 59, 55, 59, 60, 62, 69, 67];
    const unrelatedRecap = [72, 71, 69, 67, 65, 64, 62, 60, 60];
    const midi = buildMonophonicMidi(
        [...theme, ...development, ...unrelatedRecap].map((pitch, index) => ({
            pitch,
            durationTicks: durations[index % durations.length],
        })),
    );

    const result = await critique(midi, "narrative-weak-recap", {
        key: "C major",
        meter: "4/4",
        sections: [
            { id: "s1", role: "theme_a", label: "Theme", measures: 2, energy: 0.35, density: 0.35 },
            { id: "s2", role: "development", label: "Development", measures: 2, energy: 0.68, density: 0.58, motifRef: "s1" },
            { id: "s3", role: "recap", label: "Recap", measures: 2, energy: 0.32, density: 0.34, motifRef: "s1", cadence: "authentic" },
        ],
        longSpanForm: {
            expositionStartSectionId: "s1",
            developmentStartSectionId: "s2",
            recapStartSectionId: "s3",
            returnSectionId: "s3",
            expectedReturnPayoff: "clear",
            thematicCheckpoints: [
                { sourceSectionId: "s1", targetSectionId: "s2", transform: "fragment", preserveIdentity: true },
                { sourceSectionId: "s1", targetSectionId: "s3", transform: "repeat", preserveIdentity: true },
            ],
        },
    });

    assert.ok((result.metrics?.recapRecallFit ?? 1) < 0.48);
    assert.ok((result.metrics?.longSpanThematicTransformationFit ?? 1) < 0.5);
    assert.match(result.issues.join(" | "), /Recap does not clearly recall earlier thematic material/);
});

test("critique flags exposed parallel perfects and weak cadential bass support", async () => {
    const lead = [
        { pitch: 72, durationTicks: 480 },
        { pitch: 74, durationTicks: 480 },
        { pitch: 76, durationTicks: 480 },
        { pitch: 77, durationTicks: 480 },
        { pitch: 79, durationTicks: 480 },
        { pitch: 81, durationTicks: 480 },
        { pitch: 83, durationTicks: 480 },
        { pitch: 84, durationTicks: 480 },
    ];
    const bass = [
        { pitch: 48, durationTicks: 480 },
        { pitch: 50, durationTicks: 480 },
        { pitch: 52, durationTicks: 480 },
        { pitch: 53, durationTicks: 480 },
        { pitch: 55, durationTicks: 480 },
        { pitch: 57, durationTicks: 480 },
        { pitch: 59, durationTicks: 480 },
        { pitch: 50, durationTicks: 480 },
    ];
    const midi = buildMultiTrackMidi([lead, bass]);

    const result = await critique(midi, "harmonic-weak", {
        key: "C major",
        meter: "4/4",
        sections: [
            {
                id: "s1",
                role: "cadence",
                label: "Close",
                measures: 2,
                cadence: "authentic",
            },
        ],
    });

    assert.equal(result.pass, false);
    assert.ok((result.metrics?.parallelPerfectCount ?? 0) >= 2);
    assert.match(result.issues.join(" | "), /Parallel perfect intervals weaken the global outer-voice motion/);
    assert.match(result.sectionFindings?.[0]?.issues.join(" | ") ?? "", /Cadential bass motion does not support/);
    assert.equal(result.sectionFindings?.[0]?.metrics.harmonicCadenceSupport, 0);
});

test("critique accumulates piece-level harmonic route strength across modulation, preparation, and recap return", async () => {
    const lead = [
        60, 62, 64, 67, 69, 67, 64, 62,
        67, 69, 71, 74, 71, 69, 67, 66,
        67, 64, 62, 60, 64, 67, 64, 60,
    ].map((pitch) => ({ pitch, durationTicks: 480 }));
    const bass = [
        48, 48, 55, 55, 48, 48, 55, 55,
        55, 55, 62, 62, 55, 55, 62, 55,
        55, 55, 48, 48, 55, 48, 55, 48,
    ].map((pitch) => ({ pitch, durationTicks: 480 }));
    const midi = buildMultiTrackMidi([lead, bass]);

    const result = await critique(midi, "harmonic-route-strong", {
        key: "C major",
        meter: "4/4",
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 2,
                cadence: "half",
                harmonicPlan: { tonalCenter: "C major", cadence: "half", allowModulation: false },
            },
            {
                id: "s2",
                role: "development",
                label: "Development",
                measures: 2,
                cadence: "half",
                motifRef: "s1",
                harmonicPlan: { tonalCenter: "G major", cadence: "half", allowModulation: true },
            },
            {
                id: "s3",
                role: "recap",
                label: "Recap",
                measures: 2,
                cadence: "authentic",
                motifRef: "s1",
                harmonicPlan: { tonalCenter: "C major", cadence: "authentic", allowModulation: false },
            },
        ],
        longSpanForm: {
            expositionStartSectionId: "s1",
            developmentStartSectionId: "s2",
            recapStartSectionId: "s3",
            returnSectionId: "s3",
            expectedReturnPayoff: "inevitable",
        },
    });

    assert.ok((result.metrics?.harmonicModulationStrength ?? 0) >= 0.72);
    assert.ok((result.metrics?.dominantPreparationStrength ?? 0) >= 0.74);
    assert.ok((result.metrics?.recapTonalReturnStrength ?? 0) >= 0.72);
    assert.ok((result.metrics?.globalHarmonicProgressionStrength ?? 0) >= 0.74);
    assert.ok((result.metrics?.longSpanHarmonicTimingFit ?? 0) >= 0.72);
    assert.ok((result.metrics?.longSpanReturnPayoffFit ?? 0) >= 0.68);
    assert.match(result.strengths.join(" | "), /Piece-level tonal planning reads as a coherent harmonic route/);
});

test("critique flags weak piece-level harmonic route when modulation and recap tonality drift", async () => {
    const lead = [
        60, 62, 64, 67, 69, 67, 64, 62,
        64, 66, 68, 71, 68, 66, 64, 63,
        64, 66, 68, 71, 68, 66, 64, 64,
    ].map((pitch) => ({ pitch, durationTicks: 480 }));
    const bass = [
        48, 48, 55, 55, 48, 48, 55, 55,
        52, 52, 59, 59, 52, 52, 59, 52,
        45, 45, 45, 45, 45, 45, 45, 45,
    ].map((pitch) => ({ pitch, durationTicks: 480 }));
    const midi = buildMultiTrackMidi([lead, bass]);

    const result = await critique(midi, "harmonic-route-weak", {
        key: "C major",
        meter: "4/4",
        sections: [
            {
                id: "s1",
                role: "theme_a",
                label: "Theme",
                measures: 2,
                cadence: "half",
                harmonicPlan: { tonalCenter: "C major", cadence: "half", allowModulation: false },
            },
            {
                id: "s2",
                role: "development",
                label: "Drift",
                measures: 2,
                cadence: "half",
                motifRef: "s1",
                harmonicPlan: { tonalCenter: "E major", cadence: "half", allowModulation: false },
            },
            {
                id: "s3",
                role: "recap",
                label: "False return",
                measures: 2,
                cadence: "authentic",
                motifRef: "s1",
                harmonicPlan: { tonalCenter: "E major", cadence: "authentic", allowModulation: false },
            },
        ],
        longSpanForm: {
            expositionStartSectionId: "s1",
            developmentStartSectionId: "s2",
            recapStartSectionId: "s3",
            returnSectionId: "s3",
            expectedReturnPayoff: "inevitable",
        },
    });

    assert.ok((result.metrics?.harmonicModulationStrength ?? 1) < 0.48);
    assert.ok((result.metrics?.recapTonalReturnStrength ?? 1) < 0.5);
    assert.ok((result.metrics?.globalHarmonicProgressionStrength ?? 1) < 0.52);
    assert.ok((result.metrics?.longSpanHarmonicTimingFit ?? 1) < 0.45);
    assert.ok((result.metrics?.longSpanReturnPayoffFit ?? 1) < 0.6);
    assert.match(result.issues.join(" | "), /Modulation path does not land convincingly/);
    assert.match(result.issues.join(" | "), /Recap does not re-establish the opening tonic strongly enough/);
});

test("critique uses form templates to score section-level harmonic role fit", async () => {
    const midi = buildMonophonicMidi([
        { pitch: 60, durationTicks: 480 },
        { pitch: 64, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 72, durationTicks: 480 },
        { pitch: 67, durationTicks: 480 },
        { pitch: 71, durationTicks: 480 },
        { pitch: 74, durationTicks: 480 },
        { pitch: 66, durationTicks: 480 },
        { pitch: 69, durationTicks: 480 },
        { pitch: 72, durationTicks: 480 },
        { pitch: 76, durationTicks: 480 },
        { pitch: 79, durationTicks: 480 },
        { pitch: 66, durationTicks: 480 },
        { pitch: 70, durationTicks: 480 },
        { pitch: 73, durationTicks: 480 },
        { pitch: 78, durationTicks: 480 },
    ]);

    const result = await critique(midi, "form-harmonic-fit", {
        key: "C major",
        form: "sonata",
        meter: "4/4",
        sections: [
            { id: "s1", role: "theme_a", label: "Theme", measures: 1 },
            { id: "s2", role: "theme_b", label: "Contrast", measures: 1, motifRef: "s1" },
            { id: "s3", role: "development", label: "Development", measures: 1, motifRef: "s1" },
            { id: "s4", role: "recap", label: "Recap", measures: 1, motifRef: "s1", cadence: "authentic" },
        ],
    });

    const recapFinding = result.sectionFindings?.find((finding) => finding.sectionId === "s4");
    assert.ok(recapFinding);
    assert.match(recapFinding?.issues.join(" | ") ?? "", /Section tonal center drifts from planned C major/);
    assert.ok((recapFinding?.metrics.sectionHarmonicPlanFit ?? 1) < 0.48);
    assert.equal(result.weakestSections?.[0]?.sectionId, "s4");
    assert.ok((result.metrics?.sectionHarmonicPlanFit ?? 1) < 0.76);
});