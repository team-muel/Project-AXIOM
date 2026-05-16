import type {
    CompositionPlan,
    CraftScoreSummary,
    SectionArtifactSummary,
    SectionRole,
    StructureEvaluationReport,
} from "../pipeline/types.js";

// craftScoring.ts — role boundary
// ──────────────────────────────────────────────────────────────────────────────
// craftScore is a HEURISTIC proxy for structural quality.  Its two sanctioned
// uses are:
//
//   1. Hard filter  — reject candidates whose structure is garbage
//                     (use craftScorePassesHardFilter from preferenceModel.ts)
//
//   2. Shortlist ranking — order candidates by proxy quality before the
//                          preference model selects the final winner
//
// craftScore is NOT an aesthetic judge and MUST NOT be used as the sole
// selector for the final output.  Listener-feedback preference model handles
// final winner selection (see src/pipeline/preferenceModel.ts).
// ──────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Idiomatic MIDI pitch ranges (min inclusive, max inclusive)
// ---------------------------------------------------------------------------
const IDIOMATIC_RANGES: Record<string, { min: number; max: number }> = {
    Violin:    { min: 55, max: 100 }, // G3 – E7
    Viola:     { min: 48, max: 88 },  // C3 – E6
    Cello:     { min: 36, max: 72 },  // C2 – C5
    Violoncello: { min: 36, max: 72 },
};

// Roles that carry the main melodic voice
const LEAD_ROLES: Set<SectionRole> = new Set(["theme_a", "theme_b", "recap", "variation"]);
// Roles considered tonal resolution areas
const RECAP_ROLES: Set<SectionRole> = new Set(["recap", "cadence", "outro"]);

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

function intervalContour(pitches: number[]): number[] {
    const result: number[] = [];
    for (let i = 1; i < pitches.length; i++) {
        result.push(pitches[i]! - pitches[i - 1]!);
    }
    return result;
}

function contourSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const minLen = Math.min(a.length, b.length);
    let matchCount = 0;
    for (let i = 0; i < minLen; i++) {
        const sa = Math.sign(a[i]!);
        const sb = Math.sign(b[i]!);
        if (sa === sb) matchCount++;
    }
    return matchCount / minLen;
}

function rhythmicPattern(events: SectionArtifactSummary["melodyEvents"]): number[] {
    return events.filter((e) => e.type !== "rest").map((e) => e.quarterLength);
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return 0;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) { sumX += xs[i]!; sumY += ys[i]!; }
    const meanX = sumX / n;
    const meanY = sumY / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i]! - meanX;
        const dy = ys[i]! - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den < 1e-9 ? 0 : num / den;
}

// ---------------------------------------------------------------------------
// 1. syntaxValidity
// ---------------------------------------------------------------------------

/**
 * Estimates structural syntactic validity from the artifact data.
 * If sectionArtifacts are present and non-empty it scores 1.0 (the projection
 * pipeline guarantees valid data was produced).  Partial penalty when
 * essential voice events are missing.
 */
export function computeSyntaxValidity(
    sectionArtifacts: SectionArtifactSummary[],
    evaluation: StructureEvaluationReport,
): number {
    if (sectionArtifacts.length === 0) return 0;

    const normalizationWarnings: string[] = (evaluation as unknown as { normalizationWarnings?: string[] })
        .normalizationWarnings ?? [];
    const hasHardFailure = evaluation.issues.some(
        (i) =>
            i.toLowerCase().includes("parse") ||
            i.toLowerCase().includes("failed") ||
            i.toLowerCase().includes("empty"),
    );
    if (hasHardFailure) return 0;

    // Deduct for every normalization repair warning
    const repairPenalty = Math.min(0.4, normalizationWarnings.length * 0.05);

    const emptySections = sectionArtifacts.filter(
        (a) => a.melodyEvents.length === 0 && a.accompanimentEvents.length === 0,
    ).length;
    const emptyPenalty = emptySections / sectionArtifacts.length;

    return clamp01(1 - repairPenalty - emptyPenalty * 0.5);
}

// ---------------------------------------------------------------------------
// 2. sectionContractFit
// ---------------------------------------------------------------------------

/**
 * Checks expected section count, measure counts, role order, and final section.
 */
export function computeSectionContractFit(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
): { score: number; notes: string } {
    if (!plan || plan.sections.length === 0 || sectionArtifacts.length === 0) {
        return { score: 0.5, notes: "no plan or artifacts for contract evaluation" };
    }

    const planSections = plan.sections;
    const notes: string[] = [];
    let penalty = 0;

    // Section count check
    if (sectionArtifacts.length !== planSections.length) {
        const delta = Math.abs(sectionArtifacts.length - planSections.length);
        const countPenalty = Math.min(0.5, delta * 0.15);
        penalty += countPenalty;
        notes.push(`section count mismatch: plan=${planSections.length} actual=${sectionArtifacts.length}`);
    }

    // Measure count per section
    const artifactById = new Map(sectionArtifacts.map((a) => [a.sectionId, a]));
    let measureMismatches = 0;
    for (const ps of planSections) {
        const artifact = artifactById.get(ps.id);
        if (!artifact) {
            measureMismatches++;
            continue;
        }
        if (artifact.measureCount !== ps.measures) {
            measureMismatches++;
        }
    }
    if (measureMismatches > 0) {
        const measurePenalty = Math.min(0.3, measureMismatches * 0.08);
        penalty += measurePenalty;
        notes.push(`${measureMismatches} section(s) have measure count mismatch`);
    }

    // Role order check: compare the role sequence
    const planRoleOrder = planSections.map((s) => s.role);
    const artifactRoleOrder = sectionArtifacts.map((a) => a.role);
    const minLen = Math.min(planRoleOrder.length, artifactRoleOrder.length);
    let roleOrderMismatches = 0;
    for (let i = 0; i < minLen; i++) {
        if (planRoleOrder[i] !== artifactRoleOrder[i]) roleOrderMismatches++;
    }
    if (roleOrderMismatches > 0) {
        penalty += Math.min(0.2, roleOrderMismatches * 0.05);
        notes.push(`${roleOrderMismatches} role(s) out of order`);
    }

    // Final section presence
    const lastPlan = planSections[planSections.length - 1];
    const lastArtifact = sectionArtifacts[sectionArtifacts.length - 1];
    if (lastPlan && lastArtifact && lastPlan.role !== lastArtifact.role) {
        penalty += 0.1;
        notes.push(`final section role mismatch: expected ${lastPlan.role} got ${lastArtifact.role}`);
    }

    return {
        score: clamp01(1 - penalty),
        notes: notes.join("; ") || "contract satisfied",
    };
}

// ---------------------------------------------------------------------------
// 3. cadenceStrength
// ---------------------------------------------------------------------------

/**
 * Evaluates the final section for dominant-tonic bass motion, melodic
 * resolution, and harmonic support.
 */
export function computeCadenceStrength(sectionArtifacts: SectionArtifactSummary[]): {
    score: number;
    notes: string;
} {
    if (sectionArtifacts.length === 0) return { score: 0, notes: "no artifacts" };

    const finalSection = sectionArtifacts[sectionArtifacts.length - 1]!;
    const notes: string[] = [];
    let score = 0.4; // neutral start

    // Bass dominant-tonic motion: lastBassPitch + lastPitch present?
    const cadenceApproach = finalSection.cadenceApproach;
    if (cadenceApproach === "dominant") {
        score += 0.35;
        notes.push("dominant cadence approach");
    } else if (cadenceApproach === "plagal") {
        score += 0.2;
        notes.push("plagal cadence approach");
    } else if (cadenceApproach === "tonic") {
        score += 0.1;
        notes.push("tonic approach");
    }

    // Final melodic resolution: lastInterval near 0 or stepwise (±1,2)
    if (finalSection.lastInterval !== undefined) {
        const abs = Math.abs(finalSection.lastInterval);
        if (abs === 0) {
            score += 0.15;
            notes.push("melodic resolution to unison");
        } else if (abs <= 2) {
            score += 0.1;
            notes.push("stepwise melodic resolution");
        }
    }

    // phrasePeaks near end of section
    if (finalSection.phrasePeaks?.length) {
        score += 0.05;
        notes.push("phrase peak present in final section");
    }

    // bassMotionProfile indicating movement
    if (finalSection.bassMotionProfile === "stepwise" || finalSection.bassMotionProfile === "mixed") {
        score += 0.05;
    }

    return { score: clamp01(score), notes: notes.join("; ") || "no cadence signals found" };
}

// ---------------------------------------------------------------------------
// 4. tonalReturn
// ---------------------------------------------------------------------------

/**
 * Checks whether final / recap sections return to the home key.
 */
export function computeTonalReturn(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
): { score: number; notes: string } {
    if (sectionArtifacts.length === 0) return { score: 0.5, notes: "no artifacts" };

    const homeKey = plan?.key ?? "";
    const homeTonic = homeKey.split(" ")[0]?.split("/")[0] ?? "";

    const recapSections = sectionArtifacts.filter((a) => RECAP_ROLES.has(a.role));
    if (recapSections.length === 0) {
        return { score: 0.6, notes: "no recap sections to evaluate tonal return" };
    }

    if (!homeTonic) {
        return { score: 0.6, notes: "home key not specified in plan" };
    }

    const notes: string[] = [];
    let returningCount = 0;

    for (const section of recapSections) {
        // Use tonicizationWindows to check tonal center if available
        const windows = section.tonicizationWindows;
        if (windows?.length) {
            const finalWindow = windows[windows.length - 1];
            if (finalWindow?.keyTarget && finalWindow.keyTarget.startsWith(homeTonic)) {
                returningCount++;
            }
        } else {
            // Fallback: use lastPitch or realizedRegisterCenter heuristic (not precise but useful)
            returningCount += 0.5;
            notes.push("approximate tonal return check (no tonicization windows)");
        }
    }

    const returnRate = returningCount / recapSections.length;
    const score = 0.4 + returnRate * 0.6;
    notes.push(`${returningCount.toFixed(1)}/${recapSections.length} recap sections show tonal return`);

    return { score: clamp01(score), notes: notes.join("; ") };
}

// ---------------------------------------------------------------------------
// 5. motifSurvival
// ---------------------------------------------------------------------------

/**
 * Compares theme_a interval contour to recap / variation sections.
 */
export function computeMotifSurvival(sectionArtifacts: SectionArtifactSummary[]): {
    score: number;
    notes: string;
} {
    const themeA = sectionArtifacts.find((a) => a.role === "theme_a");
    const recapVariation = sectionArtifacts.filter((a) => a.role === "recap" || a.role === "variation");

    if (!themeA) return { score: 0.4, notes: "no theme_a section for motif baseline" };
    if (recapVariation.length === 0) return { score: 0.5, notes: "no recap/variation sections" };

    const themeContour = intervalContour(themeA.noteHistory);
    if (themeContour.length < 2) return { score: 0.4, notes: "theme_a interval contour too short" };

    let totalSimilarity = 0;
    const notes: string[] = [];
    for (const section of recapVariation) {
        const sectionContour = intervalContour(section.noteHistory);
        if (sectionContour.length < 2) continue;
        const sim = contourSimilarity(themeContour, sectionContour);
        totalSimilarity += sim;
        notes.push(`${section.sectionId}(${section.role}): contour similarity=${sim.toFixed(2)}`);
    }

    const avgSimilarity = totalSimilarity / recapVariation.length;
    // Map similarity [0,1] to score [0.1, 1.0]
    const score = 0.1 + avgSimilarity * 0.9;
    return { score: clamp01(score), notes: notes.join("; ") };
}

// ---------------------------------------------------------------------------
// 6. voiceIndependence
// ---------------------------------------------------------------------------

/**
 * Penalizes high rhythmic correlation between melody/accompaniment voices and
 * rewards contrary motion.
 */
export function computeVoiceIndependence(sectionArtifacts: SectionArtifactSummary[]): {
    score: number;
    notes: string;
} {
    if (sectionArtifacts.length === 0) return { score: 0.5, notes: "no artifacts" };

    const notes: string[] = [];
    const contraryRates: number[] = [];
    const independentRates: number[] = [];
    const rhythmicCorrelations: number[] = [];

    for (const section of sectionArtifacts) {
        if (section.textureContraryMotionRate !== undefined) {
            contraryRates.push(section.textureContraryMotionRate);
        }
        if (section.textureIndependentMotionRate !== undefined) {
            independentRates.push(section.textureIndependentMotionRate);
        }

        // Rhythmic correlation penalty: compare melody/accompaniment durations
        const melodyRhythm = rhythmicPattern(section.melodyEvents);
        const accompanimentRhythm = rhythmicPattern(section.accompanimentEvents);
        if (melodyRhythm.length >= 4 && accompanimentRhythm.length >= 4) {
            const corr = Math.abs(pearsonCorrelation(melodyRhythm, accompanimentRhythm));
            rhythmicCorrelations.push(corr);
        }
    }

    const avgContrary = contraryRates.length > 0
        ? contraryRates.reduce((a, b) => a + b, 0) / contraryRates.length
        : 0.3; // neutral default

    const avgIndependent = independentRates.length > 0
        ? independentRates.reduce((a, b) => a + b, 0) / independentRates.length
        : 0.4;

    const avgRhythmCorr = rhythmicCorrelations.length > 0
        ? rhythmicCorrelations.reduce((a, b) => a + b, 0) / rhythmicCorrelations.length
        : 0.5;

    // Low rhythmic correlation is good, high contrary motion is good
    const corrBonus = clamp01(1 - avgRhythmCorr);
    const score = clamp01(
        0.3 * avgContrary
        + 0.3 * avgIndependent
        + 0.4 * corrBonus,
    );

    if (contraryRates.length > 0) notes.push(`avg contrary motion rate: ${avgContrary.toFixed(2)}`);
    if (rhythmicCorrelations.length > 0) notes.push(`avg rhythmic correlation: ${avgRhythmCorr.toFixed(2)}`);

    return { score, notes: notes.join("; ") || "limited voice independence data" };
}

// ---------------------------------------------------------------------------
// 7. phraseShape
// ---------------------------------------------------------------------------

/**
 * Checks whether phrase-role alignment is coherent: presentation should have
 * higher note density, cadential should end with rests or low density,
 * continuation should sit between them.
 */
export function computePhraseShape(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
): { score: number; notes: string } {
    if (sectionArtifacts.length === 0) return { score: 0.5, notes: "no artifacts" };

    const notes: string[] = [];
    let matchCount = 0;
    let totalChecked = 0;

    for (const section of sectionArtifacts) {
        const phraseFn = section.phraseFunction;
        if (!phraseFn) continue;

        totalChecked++;
        const totalEvents = section.melodyEvents.length + section.accompanimentEvents.length;
        const restRatio =
            totalEvents === 0
                ? 0
                : section.melodyEvents.filter((e) => e.type === "rest").length / totalEvents;

        const hasCadenceApproach = section.cadenceApproach === "dominant" || section.cadenceApproach === "plagal";
        const noteCount = section.melodyEvents.filter((e) => e.type === "note").length;
        const density = noteCount / Math.max(1, section.measureCount);

        if (phraseFn === "presentation") {
            // Presentation should have notes; some density
            if (density >= 2) { matchCount++; notes.push(`${section.sectionId}: presentation density ok`); }
        } else if (phraseFn === "cadential") {
            // Cadential should have dominant/plagal approach or rests near end
            if (hasCadenceApproach || restRatio > 0.1) {
                matchCount++;
                notes.push(`${section.sectionId}: cadential has cadence approach or rests`);
            }
        } else if (phraseFn === "continuation") {
            // Continuation: score it as a match if we have some events
            if (density >= 1) { matchCount++; notes.push(`${section.sectionId}: continuation density ok`); }
        } else {
            matchCount += 0.5; // Neutral for other phrase functions
        }
    }

    if (totalChecked === 0) {
        // Fall back to plan sections for phrase function info
        const planSections = plan?.sections ?? [];
        const withPhrase = planSections.filter((s) => s.phraseFunction).length;
        return {
            score: withPhrase > 0 ? 0.5 : 0.5,
            notes: "no phrase function data in artifacts",
        };
    }

    const ratio = matchCount / totalChecked;
    return {
        score: clamp01(0.2 + ratio * 0.8),
        notes: notes.join("; ") || "phrase shape evaluated",
    };
}

// ---------------------------------------------------------------------------
// 8. registerIdiomaticFit
// ---------------------------------------------------------------------------

/**
 * Checks melody and bass pitch ranges for idiomatic instrument coverage.
 * Uses plan instrumentation to determine which instruments are used.
 */
export function computeRegisterIdiomaticFit(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
): { score: number; notes: string } {
    if (sectionArtifacts.length === 0) return { score: 0.5, notes: "no artifacts" };

    const instrumentation = plan?.instrumentation ?? [];
    const notes: string[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    for (const section of sectionArtifacts) {
        // Check melody (lead) range
        if (section.melodyPitchMin !== undefined && section.melodyPitchMax !== undefined) {
            const leadInstrument = instrumentation.find((ins) => ins.roles.includes("lead"));
            const range = IDIOMATIC_RANGES[leadInstrument?.name ?? "Violin"] ?? IDIOMATIC_RANGES["Violin"]!;
            totalChecks++;
            if (section.melodyPitchMin >= range.min - 3 && section.melodyPitchMax <= range.max + 3) {
                passedChecks++;
            } else {
                notes.push(
                    `${section.sectionId}: melody out of range (${section.melodyPitchMin}–${section.melodyPitchMax} vs ${range.min}–${range.max})`,
                );
            }
        }

        // Check bass range
        if (section.bassPitchMin !== undefined && section.bassPitchMax !== undefined) {
            const bassInstrument = instrumentation.find((ins) => ins.roles.includes("bass"));
            const range = IDIOMATIC_RANGES[bassInstrument?.name ?? "Cello"] ?? IDIOMATIC_RANGES["Cello"]!;
            totalChecks++;
            if (section.bassPitchMin >= range.min - 3 && section.bassPitchMax <= range.max + 3) {
                passedChecks++;
            } else {
                notes.push(
                    `${section.sectionId}: bass out of range (${section.bassPitchMin}–${section.bassPitchMax} vs ${range.min}–${range.max})`,
                );
            }
        }
    }

    if (totalChecks === 0) {
        return { score: 0.7, notes: "no pitch range data available" };
    }

    return {
        score: clamp01(passedChecks / totalChecks),
        notes: notes.join("; ") || "all checked ranges idiomatic",
    };
}

// ---------------------------------------------------------------------------
// Master computation
// ---------------------------------------------------------------------------

/**
 * Computes a CraftScoreSummary from section artifacts, the composition plan,
 * and the existing evaluation report (for syntaxValidity signals).
 */
export function computeCraftScoreSummary(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
    evaluation: StructureEvaluationReport,
): CraftScoreSummary {
    const syntaxValidity = computeSyntaxValidity(sectionArtifacts, evaluation);
    const contractResult = computeSectionContractFit(sectionArtifacts, plan);
    const cadenceResult = computeCadenceStrength(sectionArtifacts);
    const tonalResult = computeTonalReturn(sectionArtifacts, plan);
    const motifResult = computeMotifSurvival(sectionArtifacts);
    const voiceResult = computeVoiceIndependence(sectionArtifacts);
    const phraseResult = computePhraseShape(sectionArtifacts, plan);
    const registerResult = computeRegisterIdiomaticFit(sectionArtifacts, plan);

    const sectionContractFit = contractResult.score;
    const cadenceStrength = cadenceResult.score;
    const tonalReturn = tonalResult.score;
    const motifSurvival = motifResult.score;
    const voiceIndependence = voiceResult.score;
    const phraseShape = phraseResult.score;
    const registerIdiomaticFit = registerResult.score;

    const finalCraftScore = Number(
        (
            0.15 * sectionContractFit
            + 0.15 * cadenceStrength
            + 0.15 * tonalReturn
            + 0.15 * motifSurvival
            + 0.15 * voiceIndependence
            + 0.10 * phraseShape
            + 0.10 * registerIdiomaticFit
            + 0.05 * syntaxValidity
        ).toFixed(4),
    );

    const dimensionNotes: Record<string, string> = {};
    if (contractResult.notes) dimensionNotes["sectionContractFit"] = contractResult.notes;
    if (cadenceResult.notes) dimensionNotes["cadenceStrength"] = cadenceResult.notes;
    if (tonalResult.notes) dimensionNotes["tonalReturn"] = tonalResult.notes;
    if (motifResult.notes) dimensionNotes["motifSurvival"] = motifResult.notes;
    if (voiceResult.notes) dimensionNotes["voiceIndependence"] = voiceResult.notes;
    if (phraseResult.notes) dimensionNotes["phraseShape"] = phraseResult.notes;
    if (registerResult.notes) dimensionNotes["registerIdiomaticFit"] = registerResult.notes;

    return {
        syntaxValidity: Number(syntaxValidity.toFixed(4)),
        sectionContractFit: Number(sectionContractFit.toFixed(4)),
        cadenceStrength: Number(cadenceStrength.toFixed(4)),
        tonalReturn: Number(tonalReturn.toFixed(4)),
        motifSurvival: Number(motifSurvival.toFixed(4)),
        voiceIndependence: Number(voiceIndependence.toFixed(4)),
        phraseShape: Number(phraseShape.toFixed(4)),
        registerIdiomaticFit: Number(registerIdiomaticFit.toFixed(4)),
        finalCraftScore,
        dimensionNotes,
    };
}
