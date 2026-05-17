import type {
    CompositionPlan,
    HarmonyGrammarPlan,
    SectionArtifactSummary,
    SectionPlan,
} from "../pipeline/types.js";

// harmonyRealizationContract.ts — Harmony realization contract enforcer
// ──────────────────────────────────────────────────────────────────────────────
// Workers must produce specific harmony evidence fields for each section that
// carries a harmonyGrammar plan.  Absent fields are NOT neutral fallbacks —
// they are explicit contract violations that reduce the craft score and
// candidate ranking directly.
//
// Three required fields (every section with a harmonyGrammar plan):
//   cadenceApproach          — worker MUST annotate cadential motion
//   harmonicColorCues (≥1)   — worker MUST produce at least one cue
//   harmonicRealizationSummary — renderer MUST populate the summary
//
// Two conditional fields (only when the plan specifies them):
//   prolongationMode          — required when harmonyGrammar.prolongationMode set
//   tonicizationWindows (≥1)  — required when harmonyGrammar.tonicization set
//
// Penalty formula (in craftScoring.ts):
//   contractPenalty = max(0, (1 − contractScore) × 0.12)
//   At score=0: −0.12 on finalCraftScore (severe)
//   At score=1: no penalty
//
// Ranking formula (in structureSelection.ts):
//   harmonyContractPenalty = requiredViolationCount × 8 pts
// ──────────────────────────────────────────────────────────────────────────────

export type HarmonyContractField =
    | "cadenceApproach"
    | "harmonicColorCues"
    | "harmonicRealizationSummary"
    | "prolongationMode"
    | "tonicizationWindows";

export type HarmonyContractSeverity = "required" | "conditional";

export interface HarmonyContractViolation {
    sectionId: string;
    sectionRole: string;
    field: HarmonyContractField;
    severity: HarmonyContractSeverity;
    reason: string;
}

export interface HarmonyRealizationContractReport {
    /** All per-field, per-section violations found. */
    violations: HarmonyContractViolation[];
    /** Number of "required" severity violations (hard failures). */
    requiredViolationCount: number;
    /** Number of "conditional" severity violations. */
    conditionalViolationCount: number;
    /**
     * Section IDs with at least one "required" violation.
     * These are craft evidence failures, not warnings.
     */
    failingSections: string[];
    /**
     * Fraction of required fields present across all evaluated sections (0–1).
     * 1.0 = all required fields present in every section.
     * 0.0 = all required fields absent everywhere.
     * Used for proportional penalty in craftScoring.ts.
     */
    contractScore: number;
    /** Number of sections evaluated (those carrying a harmonyGrammar plan). */
    sectionCount: number;
}

// ---------------------------------------------------------------------------
// Per-section contract check
// ---------------------------------------------------------------------------

/**
 * Checks a single rendered section against the harmony realization contract.
 * Returns all violations found (empty array = contract met).
 */
export function checkSectionHarmonyContract(
    artifact: SectionArtifactSummary,
    planSection: SectionPlan,
): HarmonyContractViolation[] {
    const harmonyGrammar = planSection.harmonyGrammar as HarmonyGrammarPlan | undefined;
    if (!harmonyGrammar) return [];

    const violations: HarmonyContractViolation[] = [];
    const { sectionId, role } = artifact;

    // ── Required fields ──────────────────────────────────────────────────────

    if (!artifact.cadenceApproach) {
        violations.push({
            sectionId,
            sectionRole: role,
            field: "cadenceApproach",
            severity: "required",
            reason: "Worker did not produce a cadenceApproach annotation for this section.",
        });
    }

    if ((artifact.harmonicColorCues?.length ?? 0) === 0) {
        violations.push({
            sectionId,
            sectionRole: role,
            field: "harmonicColorCues",
            severity: "required",
            reason: "Worker produced no harmonicColorCues; harmonic grammar cannot be evaluated.",
        });
    }

    if (!artifact.harmonicRealizationSummary) {
        violations.push({
            sectionId,
            sectionRole: role,
            field: "harmonicRealizationSummary",
            severity: "required",
            reason: "Renderer did not produce a harmonicRealizationSummary; realization quality is unverifiable.",
        });
    }

    // ── Conditional fields ───────────────────────────────────────────────────

    if (harmonyGrammar.prolongationMode && !artifact.prolongationMode) {
        violations.push({
            sectionId,
            sectionRole: role,
            field: "prolongationMode",
            severity: "conditional",
            reason: `Plan requested prolongationMode="${harmonyGrammar.prolongationMode}" but artifact has none.`,
        });
    }

    if (harmonyGrammar.tonicization && (artifact.tonicizationWindows?.length ?? 0) === 0) {
        violations.push({
            sectionId,
            sectionRole: role,
            field: "tonicizationWindows",
            severity: "conditional",
            reason: `Plan requested tonicization to "${harmonyGrammar.tonicization.keyTarget}" but no tonicizationWindows were produced.`,
        });
    }

    return violations;
}

// ---------------------------------------------------------------------------
// Aggregate contract report
// ---------------------------------------------------------------------------

/**
 * Checks the harmony realization contract for all sections in the plan that
 * carry a harmonyGrammar annotation.
 *
 * Sections without a harmonyGrammar plan are not evaluated — they are not
 * expected to produce harmony evidence.
 *
 * `contractScore` is the fraction of required fields present across all
 * evaluated sections.  It penalises missing fields proportionally without
 * double-counting the evidence coverage penalty from evidenceCoverage.ts
 * (which uses a different weight and threshold).
 */
export function checkHarmonyRealizationContract(
    sectionArtifacts: SectionArtifactSummary[],
    plan: CompositionPlan | undefined,
): HarmonyRealizationContractReport {
    const planSections = plan?.sections ?? [];
    const artifactById = new Map(sectionArtifacts.map((a) => [a.sectionId, a]));

    const allViolations: HarmonyContractViolation[] = [];
    let totalRequired = 0;
    let presentRequired = 0;
    let sectionCount = 0;

    for (const ps of planSections) {
        if (!ps.harmonyGrammar) continue;

        const artifact = artifactById.get(ps.id);
        if (!artifact) continue;

        sectionCount++;

        // Count required checks for this section (always 3)
        const sectionRequired = 3;
        totalRequired += sectionRequired;

        const violations = checkSectionHarmonyContract(artifact, ps);
        const requiredMissing = violations.filter((v) => v.severity === "required").length;
        presentRequired += sectionRequired - requiredMissing;

        allViolations.push(...violations);
    }

    const requiredViolationCount = allViolations.filter((v) => v.severity === "required").length;
    const conditionalViolationCount = allViolations.filter((v) => v.severity === "conditional").length;

    const failingSections = [
        ...new Set(
            allViolations
                .filter((v) => v.severity === "required")
                .map((v) => v.sectionId),
        ),
    ];

    const contractScore = totalRequired > 0 ? presentRequired / totalRequired : 1.0;

    return {
        violations: allViolations,
        requiredViolationCount,
        conditionalViolationCount,
        failingSections,
        contractScore,
        sectionCount,
    };
}

// ---------------------------------------------------------------------------
// Revision directives — turning violations into actionable repair instructions
// ---------------------------------------------------------------------------
//
// buildHarmonyRepairDirectives() converts a HarmonyRealizationContractReport
// into a list of RevisionDirectives that the composition pipeline can use to
// guide the next generation attempt.
//
// Each directive pairs a field-level contract violation with a concrete
// RepairAction string so that the planner / worker / renderer knows exactly
// what to fix rather than just receiving a numeric penalty.
//
// RepairAction vocabulary:
//   strengthen_cadence              — worker must annotate cadential motion
//   clarify_harmonic_color          — worker must emit at least one harmonic cue
//   regenerate_harmony_realization  — renderer must regenerate the harmony summary
//   enforce_tonicization_window     — worker must produce tonicization windows
//   enforce_prolongation_mode       — worker must honour the planned prolongation mode
// ---------------------------------------------------------------------------

/** Concrete action the next generation pass should take to fix a violation. */
export type RepairAction =
    | "strengthen_cadence"
    | "clarify_harmonic_color"
    | "regenerate_harmony_realization"
    | "enforce_tonicization_window"
    | "enforce_prolongation_mode";

/**
 * A single repair instruction derived from a HarmonyContractViolation.
 * Directives are consumed by the composition pipeline to steer the next
 * generation attempt toward producing the missing evidence.
 */
export interface RevisionDirective {
    /** Section that must be repaired. */
    sectionId: string;
    /** Role of the section (e.g. "theme_a", "development"). */
    sectionRole: string;
    /** Which harmony evidence field is absent. */
    field: HarmonyContractField;
    /** Whether this was a hard-required or plan-conditional field. */
    severity: HarmonyContractSeverity;
    /** Concrete action the next attempt should take. */
    action: RepairAction;
    /** Human-readable explanation sourced from the original violation. */
    reason: string;
}

/** Map from a missing contract field to the canonical repair action. */
const FIELD_TO_ACTION: Record<HarmonyContractField, RepairAction> = {
    cadenceApproach:            "strengthen_cadence",
    harmonicColorCues:          "clarify_harmonic_color",
    harmonicRealizationSummary: "regenerate_harmony_realization",
    tonicizationWindows:        "enforce_tonicization_window",
    prolongationMode:           "enforce_prolongation_mode",
};

/**
 * Converts all violations in a `HarmonyRealizationContractReport` into
 * `RevisionDirective[]` that the pipeline can relay to the next generation
 * attempt.
 *
 * Required violations appear before conditional violations so that the most
 * critical repairs are addressed first.  Within each severity group, the
 * order follows the violation list (i.e. section order in the plan).
 *
 * Returns an empty array when the report has no violations.
 */
export function buildHarmonyRepairDirectives(
    report: HarmonyRealizationContractReport,
): RevisionDirective[] {
    if (report.violations.length === 0) return [];

    // Sort: required first, then conditional — preserving relative order within groups
    const sorted = [
        ...report.violations.filter((v) => v.severity === "required"),
        ...report.violations.filter((v) => v.severity === "conditional"),
    ];

    return sorted.map((v): RevisionDirective => ({
        sectionId:   v.sectionId,
        sectionRole: v.sectionRole,
        field:       v.field,
        severity:    v.severity,
        action:      FIELD_TO_ACTION[v.field],
        reason:      v.reason,
    }));
}
