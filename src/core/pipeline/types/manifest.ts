import type { PipelineState } from "../states.js";
import type { ExpressionPlanSidecar, HumanizationStyle } from "./expression.js";
import type { ClassicalKnowledgePlan, ClassicalKnowledgeSummary } from "./classical.js";
import type { SectionArtifactSummary, SectionTonalitySummary, SectionTransformSummary } from "./section.js";
import type { CompositionSketch } from "./motif.js";
import type { AudioEvaluationReport, QualityControlReport, StructureEvaluationReport } from "./evaluation.js";
import type { ModelBinding } from "./learned.js";
import type { ApprovalStatus, ArtifactPaths, ComposeSource, ComposeWorkflow, PlanRiskProfile, PlannerTelemetry, ReviewFeedback, RuntimeStatus, SelfAssessment, StructureVisibility } from "./composition.js";

export interface SongMeta {
    songId: string;
    prompt: string;
    key?: string;
    tempo?: number;
    form?: string;
    inspirationThread?: string;
    intentRationale?: string;
    contrastTarget?: string;
    riskProfile?: PlanRiskProfile;
    structureVisibility?: StructureVisibility;
    humanizationStyle?: HumanizationStyle;
    source?: ComposeSource;
    autonomyRunId?: string;
    promptHash?: string;
    workflow?: ComposeWorkflow;
    plannerVersion?: string;
    plannedSectionCount?: number;
    selectedModels?: ModelBinding[];
    plannerTelemetry?: PlannerTelemetry;
    classicalKnowledge?: ClassicalKnowledgeSummary;
    createdAt: string;
    updatedAt: string;
}

export interface JobManifest {
    songId: string;
    state: PipelineState;
    meta: SongMeta;
    artifacts: ArtifactPaths;
    errorCode?: string;
    errorMessage?: string;
    selfAssessment?: SelfAssessment;
    structureEvaluation?: StructureEvaluationReport;
    audioEvaluation?: AudioEvaluationReport;
    sectionArtifacts?: SectionArtifactSummary[];
    sectionTransforms?: SectionTransformSummary[];
    sectionTonalities?: SectionTonalitySummary[];
    expressionPlan?: ExpressionPlanSidecar;
    classicalKnowledge?: ClassicalKnowledgePlan;
    qualityControl?: QualityControlReport;
    compositionSketch?: CompositionSketch;
    approvalStatus?: ApprovalStatus;
    evaluationSummary?: string;
    reviewFeedback?: ReviewFeedback;
    runtime?: RuntimeStatus;
    stateHistory: { state: PipelineState; timestamp: string }[];
    updatedAt: string;
}
