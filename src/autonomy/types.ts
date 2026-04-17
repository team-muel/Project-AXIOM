import type {
    ApprovalStatus,
    CadenceStyle,
    ComposeQualityPolicy,
    ComposeRequest,
    ComposeWorkflow,
    HarmonicPlan,
    HumanizationStyle,
    LongSpanDivergenceSummary,
    LongSpanEvaluationSummary,
    LongSpanPressure,
    OrchestrationBalanceProfile,
    OrchestrationConversationMode,
    OrchestrationFamily,
    PlannerTelemetry,
    PlanRiskProfile,
    PhraseFunction,
    ProlongationMode,
    ReturnPayoffStrength,
    ReviewFeedback,
    SectionRole,
    StructureVisibility,
    ThematicTransformKind,
    TextureGuidance,
} from "../pipeline/types.js";

export type AutonomyRunStatus =
    | "previewed"
    | "blocked"
    | "queued"
    | "running"
    | "retry_scheduled"
    | "pending_approval"
    | "approved"
    | "rejected"
    | "failed";

export interface AutonomyPreferences {
    updatedAt: string;
    reviewedSongs: number;
    preferredForms: string[];
    preferredKeys: string[];
    recentWeaknesses: string[];
    recentPromptHashes: string[];
    recentPlanSignatures: string[];
    successPatterns?: AutonomySuccessPattern[];
    skillGaps?: AutonomySkillGap[];
    styleTendency?: AutonomyStyleTendency;
    successfulMotifReturns?: AutonomyMotifReturnPattern[];
    successfulTensionArcs?: AutonomyTensionArcPattern[];
    successfulRegisterCenters?: AutonomyRegisterCenterPattern[];
    successfulCadenceApproaches?: AutonomyCadenceApproachPattern[];
    successfulBassMotionProfiles?: AutonomyBassMotionPattern[];
    successfulSectionStyles?: AutonomySectionStylePattern[];
    successfulPhraseFunctions?: AutonomyPhraseFunctionPattern[];
    successfulTexturePlans?: AutonomyTexturePlanPattern[];
    successfulHarmonicBehaviors?: AutonomyHarmonicBehaviorPattern[];
    humanFeedbackSummary?: AutonomyHumanFeedbackSummary;
    lastReflection?: string;
}

export interface AutonomyPhraseFunctionPattern {
    form?: string;
    role?: SectionRole;
    phraseFunction: PhraseFunction;
    count: number;
}

export interface AutonomyTexturePlanPattern {
    form?: string;
    role?: SectionRole;
    voiceCount?: number;
    primaryRoles?: TextureGuidance["primaryRoles"];
    counterpointMode?: TextureGuidance["counterpointMode"];
    count: number;
}

export interface AutonomyHarmonicBehaviorPattern {
    form?: string;
    role?: SectionRole;
    harmonicRhythm?: HarmonicPlan["harmonicRhythm"];
    cadence?: CadenceStyle;
    prolongationMode?: ProlongationMode;
    allowModulation?: boolean;
    count: number;
}

export interface AutonomyHumanFeedbackSummary {
    approvedCount: number;
    rejectedCount: number;
    scoredFeedbackCount: number;
    positiveDimensions: string[];
    negativeDimensions: string[];
    rejectionReasons: string[];
    comparisonReferences: string[];
}

export interface AutonomyHumanFeedbackHighlights {
    approvedCount: number;
    rejectedCount: number;
    scoredFeedbackCount: number;
    positiveFactors: string[];
    negativeFactors: string[];
    rejectionReasons: string[];
    comparisonReferences: string[];
}

export interface AutonomyReviewFeedbackInput extends ReviewFeedback { }

export interface AutonomySuccessPattern {
    form?: string;
    key?: string;
    humanizationStyle?: HumanizationStyle;
    count: number;
}

export interface AutonomySkillGap {
    issue: string;
    count: number;
    lastSeen: string;
}

export interface AutonomyStyleTendency {
    humanizationStyle?: HumanizationStyle;
    structureVisibility?: StructureVisibility;
    riskProfile?: PlanRiskProfile;
}

export interface AutonomyMotifReturnPattern {
    form?: string;
    sourceRole: SectionRole;
    targetRole: SectionRole;
    cadence?: CadenceStyle;
    count: number;
}

export interface AutonomyTensionArcPattern {
    form?: string;
    sectionRoles: SectionRole[];
    values: number[];
    count: number;
}

export interface AutonomyRegisterCenterPattern {
    form?: string;
    role: SectionRole;
    registerCenter: number;
    count: number;
}

export interface AutonomyCadenceApproachPattern {
    form?: string;
    role: SectionRole;
    cadence?: CadenceStyle;
    cadenceApproach: "dominant" | "plagal" | "tonic" | "other";
    count: number;
}

export interface AutonomyBassMotionPattern {
    form?: string;
    role: SectionRole;
    bassMotionProfile: "pedal" | "stepwise" | "mixed" | "leaping";
    count: number;
}

export interface AutonomySectionStylePattern {
    form?: string;
    role: SectionRole;
    sectionStyle: string;
    count: number;
}

export interface AutonomyLedgerEntry {
    runId: string;
    createdAt: string;
    promptHash: string;
    planSignature?: string;
    noveltyScore?: number;
    plannerTelemetry?: PlannerTelemetry;
    status: AutonomyRunStatus;
    jobId?: string;
    songId?: string;
    approvalStatus?: ApprovalStatus;
    blockedReason?: string;
    error?: string;
    nextAttemptAt?: string;
    summary?: string;
}

export interface AutonomyActiveRun {
    runId: string;
    promptHash: string;
    acquiredAt: string;
    state: "queued" | "running" | "retry_scheduled";
    jobId?: string;
    nextAttemptAt?: string;
}

export interface AutonomyControlState {
    paused: boolean;
    pauseReason?: string;
    updatedAt: string;
    activeRun?: AutonomyActiveRun;
}

export interface AutonomySchedulerStatus {
    enabled: boolean;
    mode: "interval" | "daily";
    pollMs: number;
    intervalMs?: number;
    dailyTime?: string;
    timezone?: string;
    maxAttemptsPerDay: number;
    running: boolean;
    lastTickAt?: string;
    lastTriggerAt?: string;
    lastDecision?: string;
    lastError?: string;
}

export interface AutonomyDailyCapStatus {
    dayKey: string;
    attemptsUsed: number;
    attemptCap: number;
    remainingAttempts: number;
    capped: boolean;
}

export interface AutonomyLockHealth {
    active: boolean;
    thresholdMs: number;
    autoClearEnabled: boolean;
    stale: boolean;
    autoClearEligible: boolean;
    reason: string;
    runId?: string;
    promptHash?: string;
    state?: AutonomyActiveRun["state"];
    acquiredAt?: string;
    ageMs?: number;
    matchedJobId?: string;
    matchedJobStatus?: string;
    manifestSongId?: string;
    manifestState?: string;
}

export interface AutonomyQueueSummary {
    totalJobs: number;
    queued: number;
    running: number;
    retryScheduled: number;
    done: number;
    failed: number;
    activeAutonomyJobs: number;
}

export interface AutonomyOperationalSummary {
    dailyCap: AutonomyDailyCapStatus;
    lockHealth: AutonomyLockHealth;
    queue: AutonomyQueueSummary;
    recommendations: string[];
}

export interface RecoverableAutonomyJob {
    jobId: string;
    createdAt: string;
    status: "queued" | "running" | "retry_scheduled";
    nextAttemptAt?: string;
    error?: string;
    request: Pick<ComposeRequest, "source" | "autonomyRunId" | "promptHash">;
}

export interface AutonomyRecoverySummary {
    restoredActiveRunId?: string;
    resolvedStaleRunId?: string;
    notes: string[];
}

export interface PendingApprovalSummary {
    songId: string;
    runId?: string;
    prompt: string;
    form?: string;
    updatedAt: string;
    qualityScore?: number;
    longSpan?: LongSpanEvaluationSummary;
    longSpanDivergence?: LongSpanDivergenceSummary;
    approvalStatus: ApprovalStatus;
    plannerTelemetry?: PlannerTelemetry;
}

export interface PlannerSectionSummary {
    id: string;
    role: SectionRole;
    label: string;
    measures: number;
    cadence?: CadenceStyle;
}

export interface PlannerPlanMatchSummary {
    planSignature: string;
    source: "preferences" | "ledger";
    overlapAxes: string[];
    promptHash?: string;
    status?: AutonomyRunStatus;
}

export interface PlannerNoveltySummary {
    planSignature: string;
    noveltyScore: number;
    exactMatch: boolean;
    comparisonCount: number;
    repeatedAxes: string[];
    recentMatches: PlannerPlanMatchSummary[];
}

export interface PlannerCandidateEvaluationSummary {
    candidateId: string;
    label: string;
    form?: string;
    key?: string;
    workflow?: ComposeWorkflow;
    qualityProfile?: string;
    parserMode: "structured_json" | "fallback";
    planSignature: string;
    noveltyScore: number;
    qualityScore: number;
    selectionScore: number;
    exactMatch: boolean;
    repeatedAxes: string[];
}

export interface PlannerCandidateSelectionSummary {
    strategy: string;
    candidateCount: number;
    selectedCandidateId: string;
    selectedIndex: number;
    candidates: PlannerCandidateEvaluationSummary[];
}

export interface PlannerPlanSummary {
    workflow?: ComposeWorkflow;
    titleHint?: string;
    brief?: string;
    form?: string;
    qualityProfile?: string;
    inspirationThread?: string;
    intentRationale?: string;
    contrastTarget?: string;
    riskProfile?: PlanRiskProfile;
    structureVisibility?: StructureVisibility;
    humanizationStyle?: HumanizationStyle;
    key?: string;
    tempo?: number;
    targetDurationSec?: number;
    targetMeasures?: number;
    sectionCount: number;
    totalMeasures: number;
    mood: string[];
    instruments: string[];
    selectedModels: string[];
    qualityPolicy?: ComposeQualityPolicy;
    longSpan?: PlannerLongSpanSummary;
    orchestration?: PlannerOrchestrationSummary;
    sections: PlannerSectionSummary[];
}

export interface PlannerOrchestrationSummary {
    family: OrchestrationFamily;
    instrumentNames: string[];
    sectionCount: number;
    conversationModes: OrchestrationConversationMode[];
    balanceProfiles: OrchestrationBalanceProfile[];
}

export interface PlannerLongSpanSummary {
    expositionStartSectionId?: string;
    expositionEndSectionId?: string;
    developmentStartSectionId?: string;
    developmentEndSectionId?: string;
    retransitionSectionId?: string;
    recapStartSectionId?: string;
    returnSectionId?: string;
    delayedPayoffSectionId?: string;
    expectedDevelopmentPressure?: LongSpanPressure;
    expectedReturnPayoff?: ReturnPayoffStrength;
    thematicCheckpointCount: number;
    thematicTransforms: ThematicTransformKind[];
}

export interface AutonomyPlan {
    generatedAt: string;
    runId: string;
    promptHash: string;
    request: ComposeRequest;
    rationale: string;
    inspirationSnapshot: string[];
    planSummary?: PlannerPlanSummary;
    noveltySummary?: PlannerNoveltySummary;
    candidateSelection?: PlannerCandidateSelectionSummary;
    rawResponse: string;
}

export interface AutonomyStatus {
    enabled: boolean;
    paused: boolean;
    pauseReason?: string;
    activeRun?: AutonomyActiveRun;
    scheduler?: AutonomySchedulerStatus;
    planner: {
        logLines: number;
        manifestsRead: number;
    };
    preferences: AutonomyPreferences;
    feedbackHighlights: AutonomyHumanFeedbackHighlights;
    todayRunCount: number;
    pendingApprovalCount: number;
    pendingApprovals: PendingApprovalSummary[];
    lastRun?: AutonomyLedgerEntry;
}