import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

function readOption(name) {
    const prefix = `--${name}=`;
    const exactIndex = process.argv.indexOf(`--${name}`);
    if (exactIndex >= 0) {
        return process.argv[exactIndex + 1];
    }

    const prefixed = process.argv.find((entry) => entry.startsWith(prefix));
    if (prefixed) {
        return prefixed.slice(prefix.length);
    }

    return undefined;
}

function fail(message, details) {
    const payload = { ok: false, message, details };
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonFile(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function writeJsonlFile(filePath, rows) {
    ensureDir(path.dirname(filePath));
    const content = rows.map((row) => JSON.stringify(row)).join("\n");
    fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf-8");
}

function loadJsonIfExists(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
        return fallback;
    }
}

function toTrimmed(value) {
    return String(value ?? "").trim();
}

function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function uniqueStrings(values) {
    return [...new Set(values.map((value) => toTrimmed(value)).filter(Boolean))].sort();
}

function stableHash(parts) {
    return createHash("sha256").update(parts.join("|"), "utf-8").digest("hex").slice(0, 16);
}

function daySnapshotId(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

function resolveOutputRoot() {
    return toTrimmed(readOption("root") || process.env.OUTPUT_DIR || "outputs") || "outputs";
}

function resolveSnapshotId() {
    return toTrimmed(readOption("snapshot") || daySnapshotId()) || daySnapshotId();
}

function listManifestDirs(outputRoot) {
    if (!fs.existsSync(outputRoot)) {
        return [];
    }

    return fs.readdirSync(outputRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "_system")
        .map((entry) => entry.name)
        .sort();
}

function loadManifestBundle(outputRoot, songId) {
    const songDir = path.join(outputRoot, songId);
    const manifestPath = path.join(songDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        return null;
    }

    const manifest = loadJsonIfExists(manifestPath, null);
    if (!manifest || typeof manifest !== "object") {
        return null;
    }

    return {
        songId,
        songDir,
        manifest,
        manifestPath,
        sectionArtifactsPath: path.join(songDir, "section-artifacts.json"),
        expressionPlanPath: path.join(songDir, "expression-plan.json"),
        sectionArtifacts: loadJsonIfExists(path.join(songDir, "section-artifacts.json"), []),
        expressionPlan: loadJsonIfExists(path.join(songDir, "expression-plan.json"), null),
        ...loadCandidateBundles(songDir),
    };
}

function resolveCandidateFilePath(songDir, candidateId, fileName, preferredPath) {
    const preferred = toTrimmed(preferredPath);
    if (preferred && fs.existsSync(preferred)) {
        return preferred;
    }

    return path.join(songDir, "candidates", candidateId, fileName);
}

function loadCandidateBundles(songDir) {
    const candidateIndexPath = path.join(songDir, "candidates", "index.json");
    const candidateIndex = loadJsonIfExists(candidateIndexPath, null);
    const entries = Array.isArray(candidateIndex?.entries) ? candidateIndex.entries : [];

    const candidateBundles = entries
        .map((entry) => {
            const candidateId = toTrimmed(entry?.candidateId);
            if (!candidateId) {
                return null;
            }

            const candidateManifestPath = resolveCandidateFilePath(songDir, candidateId, "candidate-manifest.json", entry?.manifestPath);
            const candidateManifest = loadJsonIfExists(candidateManifestPath, null);
            if (!candidateManifest || typeof candidateManifest !== "object") {
                return null;
            }

            const sectionArtifactsPath = resolveCandidateFilePath(songDir, candidateId, "section-artifacts.json", entry?.sectionArtifactsPath);
            return {
                candidateId,
                summary: entry,
                candidateManifestPath,
                candidateManifest,
                sectionArtifactsPath,
                sectionArtifacts: loadJsonIfExists(sectionArtifactsPath, []),
            };
        })
        .filter(Boolean);

    return {
        candidateIndexPath,
        candidateIndex,
        candidateBundles,
    };
}

function buildGroupId(manifest) {
    const meta = manifest.meta ?? {};
    const plannerTelemetry = meta.plannerTelemetry ?? {};
    const parts = [
        toTrimmed(meta.promptHash) || "no-prompt-hash",
        toTrimmed(meta.workflow) || "no-workflow",
        toTrimmed(meta.plannerVersion) || "no-planner-version",
        toTrimmed(plannerTelemetry.planSignature) || "no-plan-signature",
        toTrimmed(meta.source) || "unknown-source",
    ];
    return stableHash(parts);
}

function resolveStructureBinding(selectedModels) {
    return Array.isArray(selectedModels)
        ? selectedModels.find((binding) => toTrimmed(binding?.role) === "structure") ?? {}
        : {};
}

function collectPlanHarmonicColorTags(sections) {
    return sections.flatMap((section) => {
        const harmonicPlan = section?.harmonicPlan ?? {};
        const cues = [];

        if (Array.isArray(harmonicPlan?.colorCues)) {
            cues.push(...harmonicPlan.colorCues.map((cue) => cue?.tag));
        }

        if (Array.isArray(harmonicPlan?.harmonicColorCues)) {
            cues.push(...harmonicPlan.harmonicColorCues.map((cue) => cue?.tag));
        }

        return cues;
    });
}

function buildPlanSummary({ manifest, meta, compositionPlan, sectionArtifacts, expressionPlan, structureEvaluation }) {
    const effectiveMeta = meta ?? manifest?.meta ?? {};
    const planSections = Array.isArray(compositionPlan?.sections) ? compositionPlan.sections : [];
    const expressionSections = Array.isArray(expressionPlan?.sections) ? expressionPlan.sections : [];
    const artifactSections = Array.isArray(sectionArtifacts) ? sectionArtifacts : [];
    const roles = uniqueStrings([
        ...planSections.map((entry) => entry?.role),
        ...artifactSections.map((entry) => entry?.role),
    ]);
    const phraseFunctions = uniqueStrings([
        ...planSections.map((entry) => entry?.phraseFunction),
        ...artifactSections.map((entry) => entry?.phraseFunction),
        ...expressionSections.map((entry) => entry?.phraseFunction),
    ]);
    const counterpointModes = uniqueStrings([
        ...planSections.map((entry) => entry?.texture?.counterpointMode),
        ...artifactSections.map((entry) => entry?.counterpointMode),
        ...expressionSections.map((entry) => entry?.texture?.counterpointMode),
        compositionPlan?.textureDefaults?.counterpointMode,
        expressionPlan?.textureDefaults?.counterpointMode,
    ]);
    const harmonicColorTags = uniqueStrings([
        ...collectPlanHarmonicColorTags(planSections),
        ...artifactSections.flatMap((entry) => Array.isArray(entry?.harmonicColorCues) ? entry.harmonicColorCues.map((cue) => cue?.tag) : []),
    ]);

    return {
        form: toTrimmed(compositionPlan?.form) || toTrimmed(effectiveMeta.form) || undefined,
        meter: toTrimmed(compositionPlan?.meter) || toTrimmed(expressionPlan?.meter) || undefined,
        key: toTrimmed(compositionPlan?.key) || toTrimmed(effectiveMeta.key) || undefined,
        tempo: toNumber(compositionPlan?.tempo) ?? toNumber(effectiveMeta.tempo),
        sectionCount: planSections.length || expressionSections.length || artifactSections.length || toNumber(effectiveMeta.plannedSectionCount),
        sectionRoles: roles,
        phraseFunctions,
        counterpointModes,
        harmonicColorTags,
        longSpanRequested: Boolean(compositionPlan?.longSpanForm || structureEvaluation?.longSpan || manifest?.structureEvaluation?.longSpan || manifest?.audioEvaluation?.longSpan),
        orchestrationFamily: toTrimmed(compositionPlan?.orchestration?.family)
            || toTrimmed(structureEvaluation?.orchestration?.family)
            || toTrimmed(manifest?.structureEvaluation?.orchestration?.family)
            || undefined,
    };
}

function buildStructurePayload(attemptRecord, structureEvaluation) {
    const selectedWeakestSections = Array.isArray(structureEvaluation?.weakestSections)
        ? structureEvaluation.weakestSections
        : [];

    const weakestSections = selectedWeakestSections.map((entry) => ({
        sectionId: toTrimmed(entry?.sectionId),
        role: toTrimmed(entry?.role),
        score: toNumber(entry?.score) ?? 0,
        topIssue: toTrimmed(entry?.issues?.[0]) || undefined,
        metrics: typeof entry?.metrics === "object" && entry.metrics ? entry.metrics : {},
    }));

    const structureLongSpan = structureEvaluation?.longSpan
        ? {
            status: toTrimmed(structureEvaluation.longSpan.status) || undefined,
            weakestDimension: toTrimmed(structureEvaluation.longSpan.weakestDimension) || undefined,
            averageFit: toNumber(structureEvaluation.longSpan.averageFit),
        }
        : undefined;

    const orchestration = structureEvaluation?.orchestration
        ? {
            family: toTrimmed(structureEvaluation.orchestration.family) || undefined,
            idiomaticRangeFit: toNumber(structureEvaluation.orchestration.idiomaticRangeFit),
            registerBalanceFit: toNumber(structureEvaluation.orchestration.registerBalanceFit),
            ensembleConversationFit: toNumber(structureEvaluation.orchestration.ensembleConversationFit),
            doublingPressureFit: toNumber(structureEvaluation.orchestration.doublingPressureFit),
            sectionHandoffFit: toNumber(structureEvaluation.orchestration.sectionHandoffFit),
        }
        : undefined;

    return {
        passed: Boolean(attemptRecord?.passed),
        score: toNumber(attemptRecord?.score),
        issues: Array.isArray(attemptRecord?.issues) ? attemptRecord.issues.map((value) => toTrimmed(value)).filter(Boolean) : [],
        strengths: Array.isArray(attemptRecord?.strengths) ? attemptRecord.strengths.map((value) => toTrimmed(value)).filter(Boolean) : [],
        metrics: typeof attemptRecord?.metrics === "object" && attemptRecord.metrics ? attemptRecord.metrics : {},
        weakestSections,
        ...(structureLongSpan ? { longSpan: structureLongSpan } : {}),
        ...(orchestration ? { orchestration } : {}),
    };
}

function buildArtifactSummary(sectionArtifacts, compositionPlan, expressionPlan) {
    const artifactSections = Array.isArray(sectionArtifacts) ? sectionArtifacts : [];
    const compositionSections = Array.isArray(compositionPlan?.sections) ? compositionPlan.sections : [];
    const expressionSections = Array.isArray(expressionPlan?.sections) ? expressionPlan.sections : [];
    const cueSections = compositionSections.length > 0 ? compositionSections : expressionSections;
    const phraseBreathCueCount = cueSections.reduce((count, section) => {
        const phraseBreath = section?.phraseBreath ?? {};
        const rubatoAnchors = Array.isArray(phraseBreath.rubatoAnchors) ? phraseBreath.rubatoAnchors.length : 0;
        return count
            + (phraseBreath.pickupStartMeasure !== undefined ? 1 : 0)
            + (phraseBreath.arrivalMeasure !== undefined ? 1 : 0)
            + (phraseBreath.releaseStartMeasure !== undefined ? 1 : 0)
            + (phraseBreath.cadenceRecoveryStartMeasure !== undefined ? 1 : 0)
            + rubatoAnchors;
    }, 0);

    const tempoMotionCueCount = cueSections.reduce((count, section) => {
        return count + (Array.isArray(section?.tempoMotion) ? section.tempoMotion.length : 0);
    }, Array.isArray(compositionPlan?.tempoMotionDefaults)
        ? compositionPlan.tempoMotionDefaults.length
        : (Array.isArray(expressionPlan?.tempoMotionDefaults) ? expressionPlan.tempoMotionDefaults.length : 0));

    const ornamentCueCount = cueSections.reduce((count, section) => {
        return count + (Array.isArray(section?.ornaments) ? section.ornaments.length : 0);
    }, Array.isArray(compositionPlan?.ornamentDefaults)
        ? compositionPlan.ornamentDefaults.length
        : (Array.isArray(expressionPlan?.ornamentDefaults) ? expressionPlan.ornamentDefaults.length : 0));

    const harmonicColorCueCount = artifactSections.reduce((count, section) => {
        return count + (Array.isArray(section?.harmonicColorCues) ? section.harmonicColorCues.length : 0);
    }, 0);

    return {
        sectionArtifactCount: artifactSections.length,
        sectionTonalityCount: Array.isArray(sectionArtifacts) ? artifactSections.filter((entry) => Boolean(toTrimmed(entry?.sectionId))).length : 0,
        phraseBreathCueCount,
        tempoMotionCueCount,
        ornamentCueCount,
        harmonicColorCueCount,
    };
}

function buildProposalEvidenceSummary(proposalEvidence) {
    if (!proposalEvidence || typeof proposalEvidence !== "object") {
        return undefined;
    }

    const normalizationWarnings = Array.isArray(proposalEvidence.normalizationWarnings)
        ? proposalEvidence.normalizationWarnings.map((value) => toTrimmed(value)).filter(Boolean)
        : [];
    const summary = proposalEvidence.summary && typeof proposalEvidence.summary === "object"
        ? {
            ...(toNumber(proposalEvidence.summary.measureCount) !== undefined ? { measureCount: toNumber(proposalEvidence.summary.measureCount) } : {}),
            ...(toNumber(proposalEvidence.summary.noteCount) !== undefined ? { noteCount: toNumber(proposalEvidence.summary.noteCount) } : {}),
            ...(toNumber(proposalEvidence.summary.partCount) !== undefined ? { partCount: toNumber(proposalEvidence.summary.partCount) } : {}),
            ...(Array.isArray(proposalEvidence.summary.partInstrumentNames)
                ? { partInstrumentNames: uniqueStrings(proposalEvidence.summary.partInstrumentNames) }
                : {}),
            ...(toTrimmed(proposalEvidence.summary.key) ? { key: toTrimmed(proposalEvidence.summary.key) } : {}),
            ...(toNumber(proposalEvidence.summary.tempo) !== undefined ? { tempo: toNumber(proposalEvidence.summary.tempo) } : {}),
            ...(toTrimmed(proposalEvidence.summary.form) ? { form: toTrimmed(proposalEvidence.summary.form) } : {}),
        }
        : undefined;

    return {
        ...(toTrimmed(proposalEvidence.worker) ? { worker: toTrimmed(proposalEvidence.worker) } : {}),
        ...(toTrimmed(proposalEvidence.lane) ? { lane: toTrimmed(proposalEvidence.lane) } : {}),
        ...(toTrimmed(proposalEvidence.provider) ? { provider: toTrimmed(proposalEvidence.provider) } : {}),
        ...(toTrimmed(proposalEvidence.model) ? { model: toTrimmed(proposalEvidence.model) } : {}),
        ...(toTrimmed(proposalEvidence.generationMode) ? { generationMode: toTrimmed(proposalEvidence.generationMode) } : {}),
        ...(toNumber(proposalEvidence.confidence) !== undefined ? { confidence: toNumber(proposalEvidence.confidence) } : {}),
        normalizationWarnings,
        normalizationWarningCount: normalizationWarnings.length,
        ...(summary && Object.keys(summary).length > 0 ? { summary } : {}),
    };
}

function collectDirectiveSectionIds(directives) {
    return uniqueStrings((Array.isArray(directives) ? directives : [])
        .flatMap((directive) => Array.isArray(directive?.sectionIds) ? directive.sectionIds : []));
}

function classifyRetryLocalization(directives) {
    const normalized = Array.isArray(directives) ? directives : [];
    if (normalized.length === 0) {
        return "none";
    }

    const targetedCount = normalized.filter((directive) => Array.isArray(directive?.sectionIds) && directive.sectionIds.length > 0).length;
    if (targetedCount === 0) {
        return "global_only";
    }
    if (targetedCount === normalized.length) {
        return "section_targeted";
    }
    return "mixed";
}

function extractRewriteDirectiveKind(transformMode) {
    const normalized = toTrimmed(transformMode);
    if (!normalized.startsWith("targeted_rewrite:")) {
        return undefined;
    }
    return toTrimmed(normalized.slice("targeted_rewrite:".length)) || undefined;
}

function buildDirectiveContext(directives, retriedFromAttempt) {
    const normalized = Array.isArray(directives) ? directives : [];

    return {
        retriedFromAttempt: toNumber(retriedFromAttempt),
        inputDirectiveKinds: uniqueStrings(normalized.map((directive) => directive?.kind)),
        inputDirectiveSectionIds: collectDirectiveSectionIds(normalized),
        retryLocalization: classifyRetryLocalization(normalized),
    };
}

function hasDirectiveSignal(directives) {
    const normalized = Array.isArray(directives) ? directives : [];
    return uniqueStrings(normalized.map((directive) => directive?.kind)).length > 0
        || collectDirectiveSectionIds(normalized).length > 0;
}

function findPreviousStructureAttempt(manifest, attempt) {
    const currentAttempt = toNumber(attempt) ?? 1;
    const attempts = buildStructureAttempts(manifest)
        .filter((entry) => toNumber(entry?.attempt) !== undefined)
        .sort((left, right) => (toNumber(left?.attempt) ?? 0) - (toNumber(right?.attempt) ?? 0));
    return [...attempts]
        .reverse()
        .find((entry) => (toNumber(entry?.attempt) ?? 0) < currentAttempt);
}

function findStructureAttempt(manifest, attempt) {
    const currentAttempt = toNumber(attempt);
    if (currentAttempt === undefined) {
        return undefined;
    }

    return buildStructureAttempts(manifest)
        .find((entry) => (toNumber(entry?.attempt) ?? 0) === currentAttempt);
}

function buildInputDirectiveContext(manifest, attempt, preferredDirectives) {
    const currentAttempt = toNumber(attempt) ?? 1;
    const sourceAttempt = findPreviousStructureAttempt(manifest, currentAttempt);
    const preferred = Array.isArray(preferredDirectives) ? preferredDirectives : [];

    if (currentAttempt > 1 && hasDirectiveSignal(preferred)) {
        return buildDirectiveContext(preferred, toNumber(sourceAttempt?.attempt) ?? currentAttempt - 1);
    }

    return buildDirectiveContext(sourceAttempt?.directives, toNumber(sourceAttempt?.attempt));
}

function resolveSelectedReviewContext(manifest, selectedCandidateBundle) {
    const selectedCandidateManifest = selectedCandidateBundle?.candidateManifest ?? null;
    const selectedCandidateSummary = selectedCandidateBundle?.summary ?? {};
    return {
        proposalEvidence: selectedCandidateManifest?.proposalEvidence
            ?? selectedCandidateSummary?.proposalEvidence
            ?? manifest?.proposalEvidence
            ?? null,
        sectionTransforms: Array.isArray(selectedCandidateManifest?.sectionTransforms)
            ? selectedCandidateManifest.sectionTransforms
            : (Array.isArray(manifest?.sectionTransforms) ? manifest.sectionTransforms : []),
    };
}

function buildReviewSignals(manifest, selectedAttempt, inputDirectiveContext, selectedCandidateBundle) {
    const reviewFeedback = manifest?.reviewFeedback ?? {};
    const selectedReviewContext = resolveSelectedReviewContext(manifest, selectedCandidateBundle);
    const sectionTransforms = selectedReviewContext.sectionTransforms;
    const selectedTransformModes = uniqueStrings(sectionTransforms.map((entry) => entry?.transformMode));
    const selectedRewriteDirectiveKinds = uniqueStrings(sectionTransforms.map((entry) => extractRewriteDirectiveKind(entry?.transformMode)));
    const selectedRewriteSectionIds = uniqueStrings(sectionTransforms.map((entry) => entry?.sectionId));
    const selectedGenerationMode = toTrimmed(selectedReviewContext.proposalEvidence?.generationMode) || undefined;

    const payload = {
        selectedAttempt,
        selectedAttemptWasRetry: selectedAttempt > 1,
        ...(toTrimmed(manifest?.approvalStatus) ? { approvalStatus: toTrimmed(manifest.approvalStatus) } : {}),
        ...(toTrimmed(reviewFeedback?.note) ? { note: toTrimmed(reviewFeedback.note) } : {}),
        ...(toNumber(reviewFeedback?.appealScore) !== undefined ? { appealScore: toNumber(reviewFeedback.appealScore) } : {}),
        ...(toTrimmed(reviewFeedback?.strongestDimension) ? { strongestDimension: toTrimmed(reviewFeedback.strongestDimension) } : {}),
        ...(toTrimmed(reviewFeedback?.weakestDimension) ? { weakestDimension: toTrimmed(reviewFeedback.weakestDimension) } : {}),
        ...(toTrimmed(reviewFeedback?.comparisonReference) ? { comparisonReference: toTrimmed(reviewFeedback.comparisonReference) } : {}),
        ...(inputDirectiveContext?.retriedFromAttempt !== undefined ? { retriedFromAttempt: inputDirectiveContext.retriedFromAttempt } : {}),
        inputDirectiveKinds: Array.isArray(inputDirectiveContext?.inputDirectiveKinds) ? inputDirectiveContext.inputDirectiveKinds : [],
        inputDirectiveSectionIds: Array.isArray(inputDirectiveContext?.inputDirectiveSectionIds) ? inputDirectiveContext.inputDirectiveSectionIds : [],
        retryLocalization: inputDirectiveContext?.retryLocalization || "none",
        ...(selectedGenerationMode ? { selectedGenerationMode } : {}),
        selectedTransformModes,
        selectedRewriteSectionIds,
        selectedRewriteDirectiveKinds,
    };

    return Object.keys(payload).length > 0 ? payload : undefined;
}

function buildFeatureAvailability(attemptRecord, structureEvaluation, sectionArtifacts, expressionPlan, compositionPlan, proposalEvidence, reviewSignals, inputDirectiveContext) {
    const proposalSummary = buildProposalEvidenceSummary(proposalEvidence);
    const hasConcreteReviewFeedback = Boolean(
        toTrimmed(reviewSignals?.approvalStatus)
        || toTrimmed(reviewSignals?.note)
        || toNumber(reviewSignals?.appealScore) !== undefined
        || toTrimmed(reviewSignals?.strongestDimension)
        || toTrimmed(reviewSignals?.weakestDimension)
        || toTrimmed(reviewSignals?.comparisonReference)
    );
    const hasInputDirectiveSignal = Boolean(
        inputDirectiveContext?.retriedFromAttempt !== undefined
        || (Array.isArray(inputDirectiveContext?.inputDirectiveKinds) && inputDirectiveContext.inputDirectiveKinds.length > 0)
        || (Array.isArray(inputDirectiveContext?.inputDirectiveSectionIds) && inputDirectiveContext.inputDirectiveSectionIds.length > 0)
        || (inputDirectiveContext?.retryLocalization && inputDirectiveContext.retryLocalization !== "none")
    );

    return {
        hasSelectedStructureReport: Boolean(structureEvaluation),
        hasAttemptMetrics: Boolean(attemptRecord && typeof attemptRecord === "object"),
        hasAttemptWeakestSections: Boolean(Array.isArray(structureEvaluation?.weakestSections) && structureEvaluation.weakestSections.length > 0),
        hasSectionArtifacts: Boolean(Array.isArray(sectionArtifacts) && sectionArtifacts.length > 0),
        hasExpressionPlan: Boolean(expressionPlan && typeof expressionPlan === "object"),
        hasCompositionPlan: Boolean(compositionPlan && typeof compositionPlan === "object"),
        hasProposalEvidence: Boolean(proposalSummary),
        hasLearnedProposalEvidence: Boolean(proposalSummary?.worker === "learned_symbolic"),
        hasProposalLane: Boolean(toTrimmed(proposalSummary?.lane)),
        hasProposalSummary: Boolean(proposalSummary?.summary && Object.keys(proposalSummary.summary).length > 0),
        hasReviewFeedback: hasConcreteReviewFeedback,
        hasReviewFeedbackNote: Boolean(toTrimmed(reviewSignals?.note)),
        hasComparisonReference: Boolean(toTrimmed(reviewSignals?.comparisonReference)),
        hasInputDirectiveContext: hasInputDirectiveSignal,
        hasTargetedRewriteContext: Boolean(
            toTrimmed(reviewSignals?.selectedGenerationMode) === "targeted_section_rewrite"
            || (Array.isArray(reviewSignals?.selectedTransformModes) && reviewSignals.selectedTransformModes.length > 0)
        ),
        selectedAttemptFeatureRich: Boolean(
            (Array.isArray(sectionArtifacts) && sectionArtifacts.length > 0)
            || (expressionPlan && typeof expressionPlan === "object")
            || (compositionPlan && typeof compositionPlan === "object")
            || (Array.isArray(structureEvaluation?.weakestSections) && structureEvaluation.weakestSections.length > 0),
        ),
        derivedFromSyntheticAttempt: Boolean(attemptRecord?.synthetic === true),
    };
}

function buildStructureAttempts(manifest) {
    const attempts = Array.isArray(manifest.qualityControl?.attempts)
        ? manifest.qualityControl.attempts.filter((entry) => entry?.stage !== "audio")
        : [];

    if (attempts.length > 0) {
        return attempts;
    }

    if (!manifest.structureEvaluation) {
        return [];
    }

    return [{
        attempt: toNumber(manifest.qualityControl?.selectedAttempt) ?? 1,
        stage: "structure",
        passed: Boolean(manifest.structureEvaluation.passed),
        score: manifest.structureEvaluation.score,
        issues: manifest.structureEvaluation.issues ?? [],
        strengths: manifest.structureEvaluation.strengths ?? [],
        metrics: manifest.structureEvaluation.metrics ?? {},
        directives: [],
        evaluatedAt: toTrimmed(manifest.updatedAt) || new Date(0).toISOString(),
        synthetic: true,
    }];
}

function buildAttemptRecordFromCandidateBundle(manifest, candidateBundle, fallbackEvaluatedAt) {
    const candidateManifest = candidateBundle.candidateManifest ?? {};
    const structureEvaluation = candidateManifest.structureEvaluation ?? {};
    const attempt = toNumber(candidateManifest.attempt ?? candidateBundle.summary?.attempt) ?? 1;
    const matchingAttempt = findStructureAttempt(manifest, attempt);

    return {
        attempt,
        stage: "structure",
        passed: Boolean(structureEvaluation.passed),
        score: structureEvaluation.score,
        issues: Array.isArray(structureEvaluation.issues) ? structureEvaluation.issues : [],
        strengths: Array.isArray(structureEvaluation.strengths) ? structureEvaluation.strengths : [],
        metrics: typeof structureEvaluation.metrics === "object" && structureEvaluation.metrics ? structureEvaluation.metrics : {},
        directives: Array.isArray(matchingAttempt?.directives) ? matchingAttempt.directives : [],
        evaluatedAt: toTrimmed(candidateManifest.evaluatedAt || candidateBundle.summary?.evaluatedAt) || fallbackEvaluatedAt,
        synthetic: false,
    };
}

function buildExamplesFromCandidateBundles(bundle) {
    const manifest = bundle.manifest;
    const workflow = toTrimmed(manifest.meta?.workflow);
    if (workflow === "audio_only") {
        return { excluded: "audio_only", examples: [] };
    }

    if (!bundle.candidateBundles.length) {
        return { excluded: "no_structure_attempts", examples: [] };
    }

    const groupId = buildGroupId(manifest);
    const selectedAttempt = toNumber(bundle.candidateIndex?.selectedAttempt ?? manifest.qualityControl?.selectedAttempt)
        ?? Math.max(...bundle.candidateBundles.map((entry) => toNumber(entry?.candidateManifest?.attempt ?? entry?.summary?.attempt) ?? 1));
    const selectedCandidateId = toTrimmed(bundle.candidateIndex?.selectedCandidateId);
    const selectedCandidateBundle = bundle.candidateBundles.find((entry) => entry.candidateId === selectedCandidateId)
        ?? bundle.candidateBundles.find((entry) => entry?.summary?.selected || entry?.candidateManifest?.selected)
        ?? bundle.candidateBundles.find((entry) => (toNumber(entry?.candidateManifest?.attempt ?? entry?.summary?.attempt) ?? 0) === selectedAttempt);
    const selectedInputDirectiveContext = buildInputDirectiveContext(
        manifest,
        selectedAttempt,
        selectedCandidateBundle?.candidateManifest?.revisionDirectives,
    );
    const reviewSignals = buildReviewSignals(manifest, selectedAttempt, selectedInputDirectiveContext, selectedCandidateBundle);
    const pairwiseReferenceCount = Math.max(0, bundle.candidateBundles.length - 1);

    const examples = bundle.candidateBundles.map((candidateBundle) => {
        const candidateManifest = candidateBundle.candidateManifest ?? {};
        const attemptRecord = buildAttemptRecordFromCandidateBundle(
            manifest,
            candidateBundle,
            toTrimmed(manifest.updatedAt) || new Date(0).toISOString(),
        );
        const attempt = toNumber(attemptRecord?.attempt) ?? 1;
        const isSelectedAttempt = Boolean(
            candidateBundle.summary?.selected
            || candidateManifest.selected
            || (selectedCandidateId && selectedCandidateId === candidateBundle.candidateId)
            || attempt === selectedAttempt,
        );
        const structureEvaluation = candidateManifest.structureEvaluation
            ?? (isSelectedAttempt ? manifest.structureEvaluation : null);
        const inputDirectiveContext = buildInputDirectiveContext(manifest, attempt, candidateManifest.revisionDirectives);
        const meta = candidateManifest.meta ?? manifest.meta ?? {};
        const executionPlan = candidateManifest.executionPlan ?? {};
        const structureBinding = resolveStructureBinding(executionPlan.selectedModels ?? meta.selectedModels);
        const planSummary = buildPlanSummary({
            manifest,
            meta,
            compositionPlan: candidateManifest.compositionPlan,
            sectionArtifacts: candidateBundle.sectionArtifacts,
            expressionPlan: null,
            structureEvaluation,
        });
        const artifactSummary = buildArtifactSummary(candidateBundle.sectionArtifacts, candidateManifest.compositionPlan, null);
        const proposalEvidence = buildProposalEvidenceSummary(candidateManifest.proposalEvidence ?? candidateBundle.summary?.proposalEvidence);

        return {
            datasetVersion: "structure_rank_v1",
            exampleId: stableHash([groupId, candidateBundle.candidateId, bundle.songId]),
            groupId,
            candidateId: candidateBundle.candidateId,
            songId: bundle.songId,
            attempt,
            createdAt: toTrimmed(attemptRecord?.evaluatedAt) || toTrimmed(manifest.updatedAt) || new Date(0).toISOString(),
            source: toTrimmed(meta?.source) || toTrimmed(manifest.meta?.source) || "api",
            worker: toTrimmed(candidateManifest.worker) || (toTrimmed(structureBinding?.model).includes("musicgen") ? "musicgen" : "music21"),
            provider: toTrimmed(candidateManifest.provider) || toTrimmed(structureBinding?.provider) || "unknown",
            model: toTrimmed(candidateManifest.model) || toTrimmed(structureBinding?.model) || "unknown",
            workflow: toTrimmed(candidateManifest.workflow) || workflow || "symbolic_only",
            planSummary,
            lineage: {
                promptHash: toTrimmed(meta?.promptHash) || undefined,
                plannerVersion: toTrimmed(meta?.plannerVersion) || undefined,
                selectedAttempt,
                priorDirectiveKinds: Array.isArray(attemptRecord?.directives)
                    ? uniqueStrings(attemptRecord.directives.map((directive) => directive?.kind))
                    : [],
                inputDirectiveKinds: inputDirectiveContext.inputDirectiveKinds,
                inputDirectiveSectionIds: inputDirectiveContext.inputDirectiveSectionIds,
                retryLocalization: inputDirectiveContext.retryLocalization,
                retriedFromAttempt: inputDirectiveContext.retriedFromAttempt,
                recoveredFromRestart: Boolean(manifest.runtime?.recovery?.recoveredFromRestart),
            },
            featureAvailability: buildFeatureAvailability(
                attemptRecord,
                structureEvaluation,
                candidateBundle.sectionArtifacts,
                null,
                candidateManifest.compositionPlan,
                candidateManifest.proposalEvidence ?? candidateBundle.summary?.proposalEvidence,
                reviewSignals,
                inputDirectiveContext,
            ),
            structure: buildStructurePayload(attemptRecord, structureEvaluation),
            symbolicArtifacts: artifactSummary,
            ...(proposalEvidence ? { proposalEvidence } : {}),
            ...(reviewSignals ? { reviewSignals } : {}),
            labels: {
                selectedWithinGroup: isSelectedAttempt,
                finalSelectedAttempt: isSelectedAttempt,
                approvedOutcome: manifest.approvalStatus === "approved" ? true : undefined,
                rejectedOutcome: manifest.approvalStatus === "rejected" ? true : undefined,
                appealScore: toNumber(manifest.reviewFeedback?.appealScore),
                strongestDimension: toTrimmed(manifest.reviewFeedback?.strongestDimension) || undefined,
                weakestDimension: toTrimmed(manifest.reviewFeedback?.weakestDimension) || undefined,
                stopReason: toTrimmed(manifest.qualityControl?.stopReason) || undefined,
                pairwiseWins: isSelectedAttempt ? pairwiseReferenceCount : 0,
                pairwiseLosses: isSelectedAttempt ? 0 : (selectedAttempt ? 1 : 0),
            },
            artifacts: {
                manifestPath: bundle.manifestPath,
                candidateManifestPath: candidateBundle.candidateManifestPath,
                midiPath: toTrimmed(candidateManifest.artifacts?.midi || candidateBundle.summary?.midiPath) || undefined,
                sectionArtifactsPath: fs.existsSync(candidateBundle.sectionArtifactsPath) ? candidateBundle.sectionArtifactsPath : undefined,
                expressionPlanPath: undefined,
            },
        };
    });

    return { excluded: null, examples };
}

function buildExamplesForBundle(bundle) {
    const manifest = bundle.manifest;
    const workflow = toTrimmed(manifest.meta?.workflow);
    if (workflow === "audio_only") {
        return { excluded: "audio_only", examples: [] };
    }

    if (Array.isArray(bundle.candidateBundles) && bundle.candidateBundles.length > 0) {
        return buildExamplesFromCandidateBundles(bundle);
    }

    const structureAttempts = buildStructureAttempts(manifest);
    if (structureAttempts.length === 0) {
        return { excluded: "no_structure_attempts", examples: [] };
    }

    const selectedModels = Array.isArray(manifest.meta?.selectedModels) ? manifest.meta.selectedModels : [];
    const structureBinding = resolveStructureBinding(selectedModels);
    const selectedAttempt = toNumber(manifest.qualityControl?.selectedAttempt)
        ?? Math.max(...structureAttempts.map((entry) => toNumber(entry?.attempt) ?? 1));
    const groupId = buildGroupId(manifest);
    const planSummary = buildPlanSummary({
        manifest,
        meta: manifest.meta,
        compositionPlan: null,
        sectionArtifacts: bundle.sectionArtifacts,
        expressionPlan: bundle.expressionPlan,
        structureEvaluation: manifest.structureEvaluation,
    });
    const artifactSummary = buildArtifactSummary(bundle.sectionArtifacts, null, bundle.expressionPlan);
    const selectedInputDirectiveContext = buildInputDirectiveContext(manifest, selectedAttempt);
    const reviewSignals = buildReviewSignals(manifest, selectedAttempt, selectedInputDirectiveContext, null);
    const pairwiseReferenceCount = Math.max(0, structureAttempts.length - 1);

    const examples = structureAttempts.map((attemptRecord) => {
        const attempt = toNumber(attemptRecord?.attempt) ?? 1;
        const isSelectedAttempt = attempt === selectedAttempt;
        const inputDirectiveContext = buildInputDirectiveContext(manifest, attempt);
        const candidateId = stableHash([
            groupId,
            String(attempt),
            toTrimmed(workflow) || "unknown-workflow",
            toTrimmed(structureBinding?.provider) || "unknown-provider",
            toTrimmed(structureBinding?.model) || "unknown-model",
            toTrimmed(attemptRecord?.evaluatedAt) || manifest.updatedAt,
        ]);

        return {
            datasetVersion: "structure_rank_v1",
            exampleId: stableHash([groupId, candidateId, bundle.songId]),
            groupId,
            candidateId,
            songId: bundle.songId,
            attempt,
            createdAt: toTrimmed(attemptRecord?.evaluatedAt) || toTrimmed(manifest.updatedAt) || new Date(0).toISOString(),
            source: toTrimmed(manifest.meta?.source) || "api",
            worker: toTrimmed(structureBinding?.model).includes("musicgen") ? "musicgen" : (toTrimmed(structureBinding?.model) ? "music21" : "music21"),
            provider: toTrimmed(structureBinding?.provider) || "unknown",
            model: toTrimmed(structureBinding?.model) || "unknown",
            workflow: workflow || "symbolic_only",
            planSummary,
            lineage: {
                promptHash: toTrimmed(manifest.meta?.promptHash) || undefined,
                plannerVersion: toTrimmed(manifest.meta?.plannerVersion) || undefined,
                selectedAttempt,
                priorDirectiveKinds: Array.isArray(attemptRecord?.directives)
                    ? uniqueStrings(attemptRecord.directives.map((directive) => directive?.kind))
                    : [],
                inputDirectiveKinds: inputDirectiveContext.inputDirectiveKinds,
                inputDirectiveSectionIds: inputDirectiveContext.inputDirectiveSectionIds,
                retryLocalization: inputDirectiveContext.retryLocalization,
                retriedFromAttempt: inputDirectiveContext.retriedFromAttempt,
                recoveredFromRestart: Boolean(manifest.runtime?.recovery?.recoveredFromRestart),
            },
            featureAvailability: buildFeatureAvailability(
                attemptRecord,
                isSelectedAttempt ? manifest.structureEvaluation : null,
                bundle.sectionArtifacts,
                bundle.expressionPlan,
                null,
                null,
                reviewSignals,
                inputDirectiveContext,
            ),
            structure: buildStructurePayload(attemptRecord, isSelectedAttempt ? manifest.structureEvaluation : null),
            symbolicArtifacts: isSelectedAttempt
                ? artifactSummary
                : {
                    sectionArtifactCount: 0,
                    sectionTonalityCount: 0,
                    phraseBreathCueCount: 0,
                    tempoMotionCueCount: 0,
                    ornamentCueCount: 0,
                    harmonicColorCueCount: 0,
                },
            ...(reviewSignals ? { reviewSignals } : {}),
            labels: {
                selectedWithinGroup: isSelectedAttempt,
                finalSelectedAttempt: isSelectedAttempt,
                approvedOutcome: manifest.approvalStatus === "approved" ? true : undefined,
                rejectedOutcome: manifest.approvalStatus === "rejected" ? true : undefined,
                appealScore: toNumber(manifest.reviewFeedback?.appealScore),
                strongestDimension: toTrimmed(manifest.reviewFeedback?.strongestDimension) || undefined,
                weakestDimension: toTrimmed(manifest.reviewFeedback?.weakestDimension) || undefined,
                stopReason: toTrimmed(manifest.qualityControl?.stopReason) || undefined,
                pairwiseWins: isSelectedAttempt ? pairwiseReferenceCount : 0,
                pairwiseLosses: isSelectedAttempt ? 0 : (selectedAttempt ? 1 : 0),
            },
            artifacts: {
                manifestPath: bundle.manifestPath,
                midiPath: toTrimmed(manifest.artifacts?.midi) || undefined,
                sectionArtifactsPath: fs.existsSync(bundle.sectionArtifactsPath) ? bundle.sectionArtifactsPath : undefined,
                expressionPlanPath: fs.existsSync(bundle.expressionPlanPath) ? bundle.expressionPlanPath : undefined,
            },
        };
    });

    return { excluded: null, examples };
}

function buildSplitPlan(groups) {
    const total = groups.length;
    if (total <= 1) {
        return { train: groups, val: [], test: [] };
    }

    if (total === 2) {
        return { train: groups.slice(0, 1), val: [], test: groups.slice(1) };
    }

    let trainCount = Math.max(1, Math.floor(total * 0.8));
    let valCount = total >= 5 ? Math.max(1, Math.floor(total * 0.1)) : 0;
    let testCount = total - trainCount - valCount;

    if (testCount === 0) {
        testCount = 1;
        trainCount = Math.max(1, trainCount - 1);
    }

    if (trainCount + valCount + testCount > total) {
        trainCount = Math.max(1, total - valCount - testCount);
    }

    const train = groups.slice(0, trainCount);
    const val = groups.slice(trainCount, trainCount + valCount);
    const test = groups.slice(trainCount + valCount);
    return { train, val, test };
}

function flattenGroupExamples(groupIds, groupedExamples) {
    return groupIds.flatMap((groupId) => groupedExamples.get(groupId) ?? []);
}

const GROUP_LEVEL_FEATURE_KEYS = new Set([
    "hasReviewFeedback",
    "hasReviewFeedbackNote",
    "hasComparisonReference",
    "hasTargetedRewriteContext",
]);

function summarizeFeatureAvailability(examples) {
    const groupScopedCounts = new Map();

    const summary = examples.reduce((accumulator, example) => {
        const availability = example.featureAvailability ?? {};
        for (const [key, value] of Object.entries(availability)) {
            if (!value) {
                continue;
            }

            if (GROUP_LEVEL_FEATURE_KEYS.has(key)) {
                const bucket = groupScopedCounts.get(key) ?? new Set();
                bucket.add(example.groupId);
                groupScopedCounts.set(key, bucket);
                continue;
            }

            accumulator[key] = (accumulator[key] ?? 0) + 1;
        }
        return accumulator;
    }, {});

    for (const [key, bucket] of groupScopedCounts.entries()) {
        if (bucket.size > 0) {
            summary[key] = bucket.size;
        }
    }

    return summary;
}

function run() {
    const outputRoot = resolveOutputRoot();
    const snapshotId = resolveSnapshotId();
    const datasetVersion = "structure_rank_v1";
    const datasetRoot = path.join(outputRoot, "_system", "ml", "datasets", "structure-rank-v1", snapshotId);

    const exclusionCounts = {
        audio_only: 0,
        no_structure_attempts: 0,
        invalid_manifest: 0,
    };

    const manifestBundles = listManifestDirs(outputRoot)
        .map((songId) => loadManifestBundle(outputRoot, songId));

    const examples = [];
    for (const bundle of manifestBundles) {
        if (!bundle) {
            exclusionCounts.invalid_manifest += 1;
            continue;
        }

        const { excluded, examples: bundleExamples } = buildExamplesForBundle(bundle);
        if (excluded) {
            exclusionCounts[excluded] = (exclusionCounts[excluded] ?? 0) + 1;
            continue;
        }

        examples.push(...bundleExamples);
    }

    const groupedExamples = new Map();
    for (const example of examples) {
        const bucket = groupedExamples.get(example.groupId) ?? [];
        bucket.push(example);
        groupedExamples.set(example.groupId, bucket);
    }

    const groups = [...groupedExamples.keys()].sort((left, right) => {
        const leftTimestamp = Math.max(...(groupedExamples.get(left) ?? []).map((example) => Date.parse(example.createdAt) || 0));
        const rightTimestamp = Math.max(...(groupedExamples.get(right) ?? []).map((example) => Date.parse(example.createdAt) || 0));
        return leftTimestamp - rightTimestamp || left.localeCompare(right);
    });

    const splitPlan = buildSplitPlan(groups);
    const trainExamples = flattenGroupExamples(splitPlan.train, groupedExamples);
    const valExamples = flattenGroupExamples(splitPlan.val, groupedExamples);
    const testExamples = flattenGroupExamples(splitPlan.test, groupedExamples);

    ensureDir(datasetRoot);
    writeJsonlFile(path.join(datasetRoot, "train.jsonl"), trainExamples);
    writeJsonlFile(path.join(datasetRoot, "val.jsonl"), valExamples);
    writeJsonlFile(path.join(datasetRoot, "test.jsonl"), testExamples);

    const datasetManifest = {
        ok: true,
        datasetVersion,
        snapshotId,
        outputRoot,
        datasetRoot,
        exportedAt: new Date().toISOString(),
        sourceManifestCount: manifestBundles.filter(Boolean).length,
        groupCount: groups.length,
        exampleCount: examples.length,
        splitCounts: {
            trainGroups: splitPlan.train.length,
            valGroups: splitPlan.val.length,
            testGroups: splitPlan.test.length,
            trainExamples: trainExamples.length,
            valExamples: valExamples.length,
            testExamples: testExamples.length,
        },
        labelDistribution: {
            selectedExamples: examples.filter((example) => example.labels?.selectedWithinGroup).length,
            approvedExamples: examples.filter((example) => example.labels?.approvedOutcome).length,
            rejectedExamples: examples.filter((example) => example.labels?.rejectedOutcome).length,
            pairwisePositiveExamples: examples.filter((example) => (example.labels?.pairwiseWins ?? 0) > 0).length,
        },
        featureAvailability: summarizeFeatureAvailability(examples),
        exclusions: exclusionCounts,
        splitPolicy: {
            grouping: "groupId-based chronological split",
            train: 0.8,
            val: 0.1,
            test: 0.1,
            notes: [
                "All examples with the same groupId stay in the same partition.",
                "Older groups are assigned before newer groups.",
                "When group count is too small, validation may be empty.",
            ],
        },
    };

    writeJsonFile(path.join(datasetRoot, "manifest.json"), datasetManifest);
    process.stdout.write(`${JSON.stringify(datasetManifest, null, 2)}\n`);
}

try {
    run();
} catch (error) {
    fail("Failed to export structure reranker dataset", {
        message: error instanceof Error ? error.message : String(error),
    });
}