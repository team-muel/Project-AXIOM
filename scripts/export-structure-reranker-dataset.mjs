import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

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

function loadJsonlIfExists(filePath) {
    if (!fs.existsSync(filePath)) {
        return [];
    }

    return fs.readFileSync(filePath, "utf-8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function cloneJsonValue(value) {
    if (value === undefined) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(value));
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

function loadManifestBundles(outputRoot) {
    return listManifestDirs(outputRoot)
        .map((songId) => loadManifestBundle(outputRoot, songId));
}

function listJsonlFiles(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => path.join(dirPath, entry.name))
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
            const rerankerScorePath = resolveCandidateFilePath(songDir, candidateId, "reranker-score.json", entry?.rerankerScorePath);
            const midiPath = resolveCandidateFilePath(songDir, candidateId, "composition.mid", entry?.midiPath);
            return {
                candidateId,
                summary: entry,
                candidateManifestPath,
                candidateManifest,
                sectionArtifactsPath,
                sectionArtifacts: loadJsonIfExists(sectionArtifactsPath, []),
                rerankerScorePath,
                rerankerScore: loadJsonIfExists(rerankerScorePath, null),
                midiPath,
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
        ...(toTrimmed(proposalEvidence.benchmarkPackVersion) ? { benchmarkPackVersion: toTrimmed(proposalEvidence.benchmarkPackVersion) } : {}),
        ...(toTrimmed(proposalEvidence.benchmarkId) ? { benchmarkId: toTrimmed(proposalEvidence.benchmarkId) } : {}),
        ...(toTrimmed(proposalEvidence.promptPackVersion) ? { promptPackVersion: toTrimmed(proposalEvidence.promptPackVersion) } : {}),
        ...(toTrimmed(proposalEvidence.planSignature) ? { planSignature: toTrimmed(proposalEvidence.planSignature) } : {}),
        ...(toTrimmed(proposalEvidence.generationMode) ? { generationMode: toTrimmed(proposalEvidence.generationMode) } : {}),
        ...(toNumber(proposalEvidence.confidence) !== undefined ? { confidence: toNumber(proposalEvidence.confidence) } : {}),
        normalizationWarnings,
        normalizationWarningCount: normalizationWarnings.length,
        ...(summary && Object.keys(summary).length > 0 ? { summary } : {}),
    };
}

function countRoleCollapseWarnings(normalizationWarnings) {
    return (Array.isArray(normalizationWarnings) ? normalizationWarnings : [])
        .filter((warning) => toTrimmed(warning).toLowerCase().includes("role collapse"))
        .length;
}

function buildProposalWarningSignals(proposalEvidenceSummary) {
    const normalizationWarnings = Array.isArray(proposalEvidenceSummary?.normalizationWarnings)
        ? proposalEvidenceSummary.normalizationWarnings
        : [];

    return {
        normalizationWarningCount: normalizationWarnings.length,
        roleCollapseWarningCount: countRoleCollapseWarnings(normalizationWarnings),
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
        ...(toTrimmed(reviewFeedback?.reviewRubricVersion) ? { reviewRubricVersion: toTrimmed(reviewFeedback.reviewRubricVersion) } : {}),
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
    const proposalWarningSignals = buildProposalWarningSignals(proposalSummary);
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
        hasProposalNormalizationWarnings: proposalWarningSignals.normalizationWarningCount > 0,
        hasProposalRoleCollapseWarnings: proposalWarningSignals.roleCollapseWarningCount > 0,
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
        const proposalWarningSignals = proposalEvidence ? buildProposalWarningSignals(proposalEvidence) : undefined;

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
            reviewTier: deriveReviewTier(manifest.approvalStatus, reviewSignals, isSelectedAttempt),
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
            ...(proposalWarningSignals ? { proposalWarningSignals } : {}),
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
            reviewTier: deriveReviewTier(manifest.approvalStatus, reviewSignals, isSelectedAttempt),
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

function hasConcreteReviewSignal(reviewSignals) {
    return Boolean(
        toTrimmed(reviewSignals?.approvalStatus)
        || toTrimmed(reviewSignals?.note)
        || toNumber(reviewSignals?.appealScore) !== undefined
        || toTrimmed(reviewSignals?.strongestDimension)
        || toTrimmed(reviewSignals?.weakestDimension)
        || toTrimmed(reviewSignals?.comparisonReference)
    );
}

function deriveReviewTier(approvalStatus, reviewSignals, selectedWithinGroup) {
    if (!selectedWithinGroup) {
        return "candidate_unselected";
    }

    const normalizedStatus = toTrimmed(approvalStatus);
    if (normalizedStatus === "approved") {
        return "reviewed_approved";
    }
    if (normalizedStatus === "rejected") {
        return "reviewed_rejected";
    }
    if (normalizedStatus === "pending" || hasConcreteReviewSignal(reviewSignals)) {
        return "reviewed_pending";
    }
    return "runtime_selected_unreviewed";
}

function resolveSelectedCandidateContext(bundle) {
    const manifest = bundle.manifest ?? {};
    const selectedAttempt = toNumber(bundle.candidateIndex?.selectedAttempt ?? manifest.qualityControl?.selectedAttempt)
        ?? Math.max(1, ...bundle.candidateBundles.map((entry) => toNumber(entry?.candidateManifest?.attempt ?? entry?.summary?.attempt) ?? 1));
    const selectedCandidateId = toTrimmed(bundle.candidateIndex?.selectedCandidateId);
    const selectedCandidateBundle = bundle.candidateBundles.find((entry) => entry.candidateId === selectedCandidateId)
        ?? bundle.candidateBundles.find((entry) => entry?.summary?.selected || entry?.candidateManifest?.selected)
        ?? bundle.candidateBundles.find((entry) => (toNumber(entry?.candidateManifest?.attempt ?? entry?.summary?.attempt) ?? 0) === selectedAttempt)
        ?? null;

    return {
        selectedAttempt,
        selectedCandidateId,
        selectedCandidateBundle,
    };
}

function buildKeySplitPlan(keys, trainRatio = 0.8, valRatio = 0.1, testRatio = 0.1) {
    const total = keys.length;
    if (total <= 1) {
        return { train: keys, val: [], test: [] };
    }

    if (total === 2) {
        return { train: keys.slice(0, 1), val: [], test: keys.slice(1) };
    }

    let trainCount = Math.max(1, Math.floor(total * trainRatio));
    let valCount = valRatio > 0 ? Math.max(0, Math.floor(total * valRatio)) : 0;
    let testCount = total - trainCount - valCount;

    if (testRatio > 0 && testCount === 0) {
        testCount = 1;
        trainCount = Math.max(1, trainCount - 1);
    }

    if (valRatio > 0 && total >= 5 && valCount === 0) {
        valCount = 1;
        if (trainCount + valCount + testCount > total) {
            trainCount = Math.max(1, trainCount - 1);
        }
    }

    while (trainCount + valCount + testCount > total) {
        if (trainCount > 1) {
            trainCount -= 1;
            continue;
        }
        if (valCount > 0) {
            valCount -= 1;
            continue;
        }
        testCount -= 1;
    }

    const train = keys.slice(0, trainCount);
    const val = keys.slice(trainCount, trainCount + valCount);
    const test = keys.slice(trainCount + valCount);
    return { train, val, test };
}

function buildSplitPlan(groups) {
    return buildKeySplitPlan(groups, 0.8, 0.1, 0.1);
}

function summarizeReviewTiers(rows) {
    return rows.reduce((summary, row) => {
        const reviewTier = toTrimmed(row?.reviewTier);
        if (!reviewTier) {
            return summary;
        }
        summary[reviewTier] = (summary[reviewTier] ?? 0) + 1;
        return summary;
    }, {});
}

function buildSourceDateRangeFromRows(rows) {
    const createdAtValues = (Array.isArray(rows) ? rows : [])
        .map((row) => toTrimmed(row?.createdAt))
        .filter(Boolean)
        .sort();

    return {
        earliestCreatedAt: createdAtValues[0] || null,
        latestCreatedAt: createdAtValues[createdAtValues.length - 1] || null,
    };
}

function sortGroupedKeysChronologically(groupedRows) {
    return [...groupedRows.keys()].sort((left, right) => {
        const leftTimestamp = Math.max(...(groupedRows.get(left) ?? []).map((row) => Date.parse(row.createdAt) || 0));
        const rightTimestamp = Math.max(...(groupedRows.get(right) ?? []).map((row) => Date.parse(row.createdAt) || 0));
        return leftTimestamp - rightTimestamp || left.localeCompare(right);
    });
}

function buildFlatDatasetSplitFamilyKey(candidates) {
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const label = toTrimmed(candidate?.label);
        const value = toTrimmed(candidate?.value);
        if (label && value) {
            return `${label}:${value}`;
        }
    }

    return "unknown";
}

function writeFlatRowDataset({
    datasetVersion,
    outputRoot,
    snapshotId,
    rows,
    splitKey,
    grouping,
    splitRatios,
    exclusions,
    notes,
}) {
    const datasetRoot = path.join(outputRoot, "_system", "ml", "datasets", datasetVersion, snapshotId);
    const groupedRows = new Map();

    for (const row of rows) {
        const key = toTrimmed(row?.[splitKey]) || "unknown";
        const bucket = groupedRows.get(key) ?? [];
        bucket.push(row);
        groupedRows.set(key, bucket);
    }

    const keys = sortGroupedKeysChronologically(groupedRows);
    const effectiveGrouping = toTrimmed(grouping) || `${splitKey}-based chronological split`;
    const splitPlan = buildKeySplitPlan(
        keys,
        splitRatios?.train ?? 0.7,
        splitRatios?.val ?? 0.15,
        splitRatios?.test ?? 0.15,
    );
    const splitCounts = {
        trainKeys: splitPlan.train.length,
        valKeys: splitPlan.val.length,
        testKeys: splitPlan.test.length,
        trainRows: flattenGroupExamples(splitPlan.train, groupedRows).length,
        valRows: flattenGroupExamples(splitPlan.val, groupedRows).length,
        testRows: flattenGroupExamples(splitPlan.test, groupedRows).length,
    };

    ensureDir(datasetRoot);
    writeJsonlFile(path.join(datasetRoot, "rows.jsonl"), rows);
    writeJsonFile(path.join(datasetRoot, "splits.json"), {
        splitKey,
        grouping: effectiveGrouping,
        ratios: splitRatios,
        train: splitPlan.train,
        val: splitPlan.val,
        test: splitPlan.test,
        splitCounts,
        notes,
    });

    const manifest = {
        ok: true,
        datasetVersion,
        snapshotId,
        outputRoot,
        datasetRoot,
        exportedAt: new Date().toISOString(),
        rowCount: rows.length,
        sourceManifestCount: uniqueStrings(rows.map((row) => row?.songId)).length,
        splitCounts,
        reviewTierCounts: summarizeReviewTiers(rows),
        sourceDateRange: buildSourceDateRangeFromRows(rows),
        exclusions,
        splitPolicy: {
            grouping: effectiveGrouping,
            ...splitRatios,
            notes,
        },
    };

    writeJsonFile(path.join(datasetRoot, "manifest.json"), manifest);
    return manifest;
}

function buildBackbonePieceRows(manifestBundles) {
    const exclusionCounts = {
        audio_only: 0,
        invalid_manifest: 0,
    };
    const rows = [];

    for (const bundle of manifestBundles) {
        if (!bundle) {
            exclusionCounts.invalid_manifest += 1;
            continue;
        }

        const manifest = bundle.manifest ?? {};
        const workflow = toTrimmed(manifest.meta?.workflow);
        if (workflow === "audio_only") {
            exclusionCounts.audio_only += 1;
            continue;
        }

        const { selectedAttempt, selectedCandidateId, selectedCandidateBundle } = resolveSelectedCandidateContext(bundle);
        const selectedCandidateManifest = selectedCandidateBundle?.candidateManifest ?? {};
        const selectedCompositionPlan = selectedCandidateManifest.compositionPlan ?? manifest.compositionPlan ?? null;
        const selectedSectionArtifacts = Array.isArray(selectedCandidateBundle?.sectionArtifacts) && selectedCandidateBundle.sectionArtifacts.length > 0
            ? selectedCandidateBundle.sectionArtifacts
            : bundle.sectionArtifacts;
        const selectedStructureEvaluation = selectedCandidateManifest.structureEvaluation ?? manifest.structureEvaluation ?? null;
        const selectedMeta = selectedCandidateManifest.meta ?? manifest.meta ?? {};
        const selectedExecutionPlan = selectedCandidateManifest.executionPlan ?? {};
        const selectedModels = selectedExecutionPlan.selectedModels ?? selectedMeta.selectedModels ?? manifest.meta?.selectedModels ?? [];
        const structureBinding = resolveStructureBinding(selectedModels);
        const inputDirectiveContext = buildInputDirectiveContext(manifest, selectedAttempt, selectedCandidateManifest.revisionDirectives);
        const reviewSignals = buildReviewSignals(manifest, selectedAttempt, inputDirectiveContext, selectedCandidateBundle);
        const proposalEvidence = buildProposalEvidenceSummary(
            selectedCandidateManifest.proposalEvidence
            ?? selectedCandidateBundle?.summary?.proposalEvidence
            ?? manifest.proposalEvidence,
        );
        const promptHash = toTrimmed(selectedMeta?.promptHash) || toTrimmed(manifest.meta?.promptHash) || undefined;
        const proposalPlanSignature = toTrimmed(proposalEvidence?.planSignature) || undefined;
        const proposalWarningSignals = proposalEvidence ? buildProposalWarningSignals(proposalEvidence) : undefined;
        const planSummary = buildPlanSummary({
            manifest,
            meta: selectedMeta,
            compositionPlan: selectedCompositionPlan,
            sectionArtifacts: selectedSectionArtifacts,
            expressionPlan: bundle.expressionPlan,
            structureEvaluation: selectedStructureEvaluation,
        });

        rows.push({
            datasetVersion: "axiom_backbone_piece_v1",
            rowId: stableHash([bundle.songId, String(selectedAttempt), selectedCandidateId || "manifest-selected"]),
            songId: bundle.songId,
            createdAt: toTrimmed(selectedCandidateManifest.evaluatedAt) || toTrimmed(manifest.updatedAt) || new Date(0).toISOString(),
            source: toTrimmed(selectedMeta?.source) || toTrimmed(manifest.meta?.source) || "api",
            workflow: toTrimmed(selectedCandidateManifest.workflow) || workflow || "symbolic_only",
            selectedAttempt,
            selectedCandidateId: selectedCandidateId || undefined,
            splitFamilyKey: buildFlatDatasetSplitFamilyKey([
                { label: "promptHash", value: promptHash },
                { label: "proposalPlanSignature", value: proposalPlanSignature },
                { label: "songId", value: bundle.songId },
            ]),
            selectedWorker: toTrimmed(selectedCandidateManifest.worker) || (toTrimmed(structureBinding?.model).includes("musicgen") ? "musicgen" : "music21"),
            selectedProvider: toTrimmed(selectedCandidateManifest.provider) || toTrimmed(structureBinding?.provider) || "unknown",
            selectedModel: toTrimmed(selectedCandidateManifest.model) || toTrimmed(structureBinding?.model) || "unknown",
            reviewTier: deriveReviewTier(manifest.approvalStatus, reviewSignals, true),
            planSummary,
            conditioning: {
                prompt: toTrimmed(manifest.meta?.prompt) || undefined,
                promptHash,
                plannerVersion: toTrimmed(selectedMeta?.plannerVersion) || toTrimmed(manifest.meta?.plannerVersion) || undefined,
                selectedModels: cloneJsonValue(selectedModels),
                compositionPlan: cloneJsonValue(selectedCompositionPlan),
                expressionPlan: cloneJsonValue(bundle.expressionPlan),
            },
            directiveContext: {
                retriedFromAttempt: inputDirectiveContext.retriedFromAttempt,
                inputDirectiveKinds: inputDirectiveContext.inputDirectiveKinds,
                inputDirectiveSectionIds: inputDirectiveContext.inputDirectiveSectionIds,
                retryLocalization: inputDirectiveContext.retryLocalization,
            },
            qualityLabels: {
                approvalStatus: toTrimmed(manifest.approvalStatus) || undefined,
                appealScore: toNumber(manifest.reviewFeedback?.appealScore),
                structureScore: toNumber(selectedStructureEvaluation?.score),
                audioScore: toNumber(manifest.audioEvaluation?.score),
                longSpanStatus: toTrimmed(selectedStructureEvaluation?.longSpan?.status)
                    || toTrimmed(manifest.audioEvaluation?.longSpan?.status)
                    || undefined,
                retryCount: Math.max(0, selectedAttempt - 1),
                stopReason: toTrimmed(manifest.qualityControl?.stopReason) || undefined,
            },
            ...(proposalEvidence ? { proposalEvidence } : {}),
            ...(proposalWarningSignals ? { proposalWarningSignals } : {}),
            ...(reviewSignals ? { reviewSignals } : {}),
            artifacts: {
                manifestPath: bundle.manifestPath,
                candidateManifestPath: selectedCandidateBundle?.candidateManifestPath,
                midiPath: toTrimmed(selectedCandidateManifest.artifacts?.midi || selectedCandidateBundle?.summary?.midiPath || manifest.artifacts?.midi) || undefined,
                sectionArtifactsPath: fs.existsSync(selectedCandidateBundle?.sectionArtifactsPath ?? "")
                    ? selectedCandidateBundle.sectionArtifactsPath
                    : (fs.existsSync(bundle.sectionArtifactsPath) ? bundle.sectionArtifactsPath : undefined),
                expressionPlanPath: fs.existsSync(bundle.expressionPlanPath) ? bundle.expressionPlanPath : undefined,
            },
        });
    }

    return { rows, exclusions: exclusionCounts };
}

export function exportBackbonePieceDataset({ outputRoot, snapshotId, manifestBundles } = {}) {
    const effectiveOutputRoot = toTrimmed(outputRoot) || resolveOutputRoot();
    const effectiveSnapshotId = toTrimmed(snapshotId) || resolveSnapshotId();
    const effectiveManifestBundles = Array.isArray(manifestBundles)
        ? manifestBundles
        : loadManifestBundles(effectiveOutputRoot);

    return writeFlatRowDataset({
        datasetVersion: "axiom_backbone_piece_v1",
        outputRoot: effectiveOutputRoot,
        snapshotId: effectiveSnapshotId,
        ...buildBackbonePieceRows(effectiveManifestBundles),
        splitKey: "splitFamilyKey",
        grouping: "promptHash/proposalPlanSignature/songId family-based chronological split",
        splitRatios: { train: 0.7, val: 0.15, test: 0.15 },
        notes: [
            "Rows sharing the same promptHash stay in the same partition; proposalPlanSignature is the next fallback, then songId.",
            "Rows are ordered chronologically by latest createdAt within each partition family.",
            "The exporter keeps selected-piece rows reconstructable from persisted truth-plane artifacts only.",
        ],
    });
}

function buildLocalizedRewriteRows(manifestBundles) {
    const exclusionCounts = {
        audio_only: 0,
        invalid_manifest: 0,
        no_targeted_rewrites: 0,
    };
    const rows = [];

    for (const bundle of manifestBundles) {
        if (!bundle) {
            exclusionCounts.invalid_manifest += 1;
            continue;
        }

        const manifest = bundle.manifest ?? {};
        const workflow = toTrimmed(manifest.meta?.workflow);
        if (workflow === "audio_only") {
            exclusionCounts.audio_only += 1;
            continue;
        }

        const { selectedAttempt, selectedCandidateId, selectedCandidateBundle } = resolveSelectedCandidateContext(bundle);
        const selectedInputDirectiveContext = buildInputDirectiveContext(
            manifest,
            selectedAttempt,
            selectedCandidateBundle?.candidateManifest?.revisionDirectives,
        );
        const selectedReviewSignals = buildReviewSignals(manifest, selectedAttempt, selectedInputDirectiveContext, selectedCandidateBundle);

        let rewriteCount = 0;
        for (const candidateBundle of bundle.candidateBundles ?? []) {
            const candidateManifest = candidateBundle.candidateManifest ?? {};
            const attempt = toNumber(candidateManifest.attempt ?? candidateBundle.summary?.attempt) ?? 1;
            const isSelectedWithinGroup = Boolean(
                candidateBundle.summary?.selected
                || candidateManifest.selected
                || (selectedCandidateId && selectedCandidateId === candidateBundle.candidateId)
                || attempt === selectedAttempt
            );
            const inputDirectiveContext = buildInputDirectiveContext(manifest, attempt, candidateManifest.revisionDirectives);
            const proposalEvidence = buildProposalEvidenceSummary(candidateManifest.proposalEvidence ?? candidateBundle.summary?.proposalEvidence);
            const promptHash = toTrimmed(candidateManifest.meta?.promptHash) || toTrimmed(manifest.meta?.promptHash) || undefined;
            const proposalPlanSignature = toTrimmed(proposalEvidence?.planSignature) || undefined;
            const proposalWarningSignals = proposalEvidence ? buildProposalWarningSignals(proposalEvidence) : undefined;
            const transforms = Array.isArray(candidateManifest.sectionTransforms)
                ? candidateManifest.sectionTransforms.filter((entry) => Boolean(extractRewriteDirectiveKind(entry?.transformMode)))
                : [];
            if (transforms.length === 0) {
                continue;
            }

            const artifactSections = Array.isArray(candidateBundle.sectionArtifacts) ? candidateBundle.sectionArtifacts : [];
            const planSections = Array.isArray(candidateManifest.compositionPlan?.sections)
                ? candidateManifest.compositionPlan.sections
                : [];
            const allSectionIds = uniqueStrings([
                ...artifactSections.map((entry) => entry?.sectionId),
                ...planSections.map((entry) => entry?.sectionId ?? entry?.id),
            ]);

            for (const transform of transforms) {
                const targetSectionId = toTrimmed(transform?.sectionId);
                const directiveKind = extractRewriteDirectiveKind(transform?.transformMode);
                if (!targetSectionId || !directiveKind) {
                    continue;
                }

                const targetArtifact = artifactSections.find((entry) => toTrimmed(entry?.sectionId) === targetSectionId) ?? null;
                const targetPlanSection = planSections.find((entry) => toTrimmed(entry?.sectionId ?? entry?.id) === targetSectionId) ?? null;
                const preservedNeighborIds = allSectionIds.filter((sectionId) => sectionId !== targetSectionId);
                const harmonicColorTags = uniqueStrings(
                    Array.isArray(targetArtifact?.harmonicColorCues)
                        ? targetArtifact.harmonicColorCues.map((cue) => cue?.tag)
                        : [],
                );

                rows.push({
                    datasetVersion: "axiom_localized_rewrite_v1",
                    rowId: stableHash([bundle.songId, candidateBundle.candidateId, targetSectionId, directiveKind, String(attempt)]),
                    songId: bundle.songId,
                    candidateId: candidateBundle.candidateId,
                    attempt,
                    splitFamilyKey: buildFlatDatasetSplitFamilyKey([
                        { label: "promptHash", value: promptHash },
                        { label: "proposalPlanSignature", value: proposalPlanSignature },
                        { label: "songId", value: bundle.songId },
                    ]),
                    createdAt: toTrimmed(candidateManifest.evaluatedAt || candidateBundle.summary?.evaluatedAt) || toTrimmed(manifest.updatedAt) || new Date(0).toISOString(),
                    source: toTrimmed(candidateManifest.meta?.source) || toTrimmed(manifest.meta?.source) || "api",
                    workflow: toTrimmed(candidateManifest.workflow) || workflow || "symbolic_only",
                    reviewTier: deriveReviewTier(manifest.approvalStatus, selectedReviewSignals, isSelectedWithinGroup),
                    rewriteContext: {
                        targetSectionId,
                        transformMode: toTrimmed(transform?.transformMode) || undefined,
                        directiveKind,
                        sourceSectionId: toTrimmed(transform?.sourceSectionId) || undefined,
                        sourceAttempt: toNumber(transform?.sourceAttempt) ?? inputDirectiveContext.retriedFromAttempt,
                        inputDirectiveKinds: inputDirectiveContext.inputDirectiveKinds,
                        inputDirectiveSectionIds: inputDirectiveContext.inputDirectiveSectionIds,
                        retryLocalization: inputDirectiveContext.retryLocalization,
                        preservedNeighborCount: preservedNeighborIds.length,
                        frozenSectionIds: preservedNeighborIds,
                    },
                    targetSection: {
                        role: toTrimmed(targetArtifact?.role || targetPlanSection?.role) || undefined,
                        phraseFunction: toTrimmed(targetArtifact?.phraseFunction || targetPlanSection?.phraseFunction) || undefined,
                        measureCount: toNumber(targetArtifact?.measureCount || targetPlanSection?.measures),
                        noteHistoryCount: Array.isArray(targetArtifact?.noteHistory) ? targetArtifact.noteHistory.length : 0,
                        noteHistoryPreview: Array.isArray(targetArtifact?.noteHistory) ? targetArtifact.noteHistory.slice(0, 8) : [],
                        harmonicColorTags,
                    },
                    ...(proposalEvidence ? { proposalEvidence } : {}),
                    ...(proposalWarningSignals ? { proposalWarningSignals } : {}),
                    labels: {
                        selectedCandidate: isSelectedWithinGroup,
                        selectedAfterRetry: isSelectedWithinGroup && attempt > 1 ? true : undefined,
                        approvedOutcome: isSelectedWithinGroup && manifest.approvalStatus === "approved" ? true : undefined,
                        rejectedOutcome: isSelectedWithinGroup && manifest.approvalStatus === "rejected" ? true : undefined,
                        appealScore: isSelectedWithinGroup ? toNumber(manifest.reviewFeedback?.appealScore) : undefined,
                    },
                    artifacts: {
                        manifestPath: bundle.manifestPath,
                        candidateManifestPath: candidateBundle.candidateManifestPath,
                        candidateSectionArtifactsPath: fs.existsSync(candidateBundle.sectionArtifactsPath) ? candidateBundle.sectionArtifactsPath : undefined,
                        selectedManifestSectionArtifactsPath: fs.existsSync(bundle.sectionArtifactsPath) ? bundle.sectionArtifactsPath : undefined,
                    },
                });
                rewriteCount += 1;
            }
        }

        if (rewriteCount === 0) {
            exclusionCounts.no_targeted_rewrites += 1;
        }
    }

    return { rows, exclusions: exclusionCounts };
}

export function exportLocalizedRewriteDataset({ outputRoot, snapshotId, manifestBundles } = {}) {
    const effectiveOutputRoot = toTrimmed(outputRoot) || resolveOutputRoot();
    const effectiveSnapshotId = toTrimmed(snapshotId) || resolveSnapshotId();
    const effectiveManifestBundles = Array.isArray(manifestBundles)
        ? manifestBundles
        : loadManifestBundles(effectiveOutputRoot);

    return writeFlatRowDataset({
        datasetVersion: "axiom_localized_rewrite_v1",
        outputRoot: effectiveOutputRoot,
        snapshotId: effectiveSnapshotId,
        ...buildLocalizedRewriteRows(effectiveManifestBundles),
        splitKey: "splitFamilyKey",
        grouping: "promptHash/proposalPlanSignature/songId family-based chronological split",
        splitRatios: { train: 0.7, val: 0.15, test: 0.15 },
        notes: [
            "Rewrite rows sharing the same promptHash stay in the same partition; proposalPlanSignature is the next fallback, then songId.",
            "Rows are emitted only when persisted rewrite transforms identify a targeted section.",
            "The exporter preserves retry-localization context without reading transient runtime state.",
        ],
    });
}

function extractSongIdFromArtifactLinks(artifactLinks) {
    const normalizedLinks = Array.isArray(artifactLinks) ? artifactLinks : [];
    for (const entry of normalizedLinks) {
        const normalized = toTrimmed(entry).replace(/\\/g, "/");
        if (!normalized) {
            continue;
        }

        const parts = normalized.split("/").filter(Boolean);
        if (parts.length >= 3 && parts[parts.length - 1] === "manifest.json") {
            return toTrimmed(parts[parts.length - 2]) || undefined;
        }
    }

    return undefined;
}

function extractSongIdFromOperatorAction(record) {
    return toTrimmed(record?.input?.songId)
        || toTrimmed(record?.after?.songId)
        || toTrimmed(record?.before?.songId)
        || extractSongIdFromArtifactLinks(record?.artifactLinks)
        || undefined;
}

function loadOperatorActionAuditIndex(outputRoot) {
    const latestPath = path.join(outputRoot, "_system", "operator-actions", "latest.json");
    const historyDir = path.join(outputRoot, "_system", "operator-actions", "history");
    const rawRecords = [];
    const latestRecord = loadJsonIfExists(latestPath, null);
    if (latestRecord && typeof latestRecord === "object") {
        rawRecords.push(latestRecord);
    }

    for (const filePath of listJsonlFiles(historyDir)) {
        rawRecords.push(...loadJsonlIfExists(filePath));
    }

    const recordsBySongId = new Map();
    const seenKeys = new Set();
    for (const record of rawRecords) {
        const songId = extractSongIdFromOperatorAction(record);
        const action = toTrimmed(record?.action);
        if (!songId || !action) {
            continue;
        }

        const dedupeKey = [
            songId,
            action,
            toTrimmed(record?.observedAt),
            toTrimmed(record?.surface),
            toTrimmed(record?.approvedBy),
        ].join("|");
        if (seenKeys.has(dedupeKey)) {
            continue;
        }
        seenKeys.add(dedupeKey);

        const bucket = recordsBySongId.get(songId) ?? [];
        bucket.push({
            songId,
            action,
            observedAt: toTrimmed(record?.observedAt) || new Date(0).toISOString(),
            surface: toTrimmed(record?.surface) || undefined,
            approvedBy: toTrimmed(record?.approvedBy) || undefined,
            actor: toTrimmed(record?.actor) || undefined,
            reason: toTrimmed(record?.reason) || undefined,
            artifactLinks: Array.isArray(record?.artifactLinks)
                ? record.artifactLinks.map((value) => toTrimmed(value)).filter(Boolean)
                : [],
        });
        recordsBySongId.set(songId, bucket);
    }

    for (const [songId, records] of recordsBySongId.entries()) {
        recordsBySongId.set(songId, records.sort((left, right) => {
            const leftTimestamp = Date.parse(left.observedAt) || 0;
            const rightTimestamp = Date.parse(right.observedAt) || 0;
            return leftTimestamp - rightTimestamp || left.action.localeCompare(right.action);
        }));
    }

    return {
        latestPath,
        historyDir,
        recordsBySongId,
    };
}

function loadRuntimeShadowHistoryIndex(outputRoot) {
    const historyDir = path.join(outputRoot, "_system", "ml", "runtime", "structure-rank-v1-shadow-history");
    const entriesBySongId = new Map();

    for (const filePath of listJsonlFiles(historyDir)) {
        const rows = loadJsonlIfExists(filePath)
            .filter((entry) => toTrimmed(entry?.kind) === "structure_shadow" && toTrimmed(entry?.songId));
        for (const row of rows) {
            const songId = toTrimmed(row.songId);
            const bucket = entriesBySongId.get(songId) ?? [];
            bucket.push({
                generatedAt: toTrimmed(row.generatedAt) || new Date(0).toISOString(),
                songId,
                snapshotId: toTrimmed(row.snapshotId) || undefined,
                candidateCount: toNumber(row.candidateCount),
                selectedCandidateId: toTrimmed(row.selectedCandidateId) || undefined,
                heuristicTopCandidateId: toTrimmed(row.heuristicTopCandidateId) || undefined,
                learnedTopCandidateId: toTrimmed(row.learnedTopCandidateId) || undefined,
                confidence: toNumber(row.confidence),
                disagreement: Boolean(row.disagreement),
                reason: toTrimmed(row.reason) || undefined,
                scorePaths: Array.isArray(row.scorePaths)
                    ? row.scorePaths.map((value) => toTrimmed(value)).filter(Boolean)
                    : [],
            });
            entriesBySongId.set(songId, bucket);
        }
    }

    for (const [songId, entries] of entriesBySongId.entries()) {
        entriesBySongId.set(songId, entries.sort((left, right) => {
            const leftTimestamp = Date.parse(left.generatedAt) || 0;
            const rightTimestamp = Date.parse(right.generatedAt) || 0;
            return leftTimestamp - rightTimestamp || toTrimmed(left.snapshotId).localeCompare(toTrimmed(right.snapshotId));
        }));
    }

    return {
        historyDir,
        entriesBySongId,
    };
}

function buildReviewAuditSummary(songId, operatorActionIndex) {
    const records = operatorActionIndex.recordsBySongId.get(songId) ?? [];
    if (!records.length) {
        return undefined;
    }

    const latest = records[records.length - 1];
    return {
        historyCount: records.length,
        latestAction: latest.action,
        latestObservedAt: latest.observedAt,
        latestSurface: latest.surface,
        latestApprovedBy: latest.approvedBy,
        latestActor: latest.actor,
        latestReason: latest.reason,
    };
}

function buildRuntimeShadowSummary(songId, runtimeShadowIndex) {
    const entries = runtimeShadowIndex.entriesBySongId.get(songId) ?? [];
    if (!entries.length) {
        return undefined;
    }

    const latest = entries[entries.length - 1];
    return {
        entryCount: entries.length,
        disagreementCount: entries.filter((entry) => entry.disagreement).length,
        latestGeneratedAt: latest.generatedAt,
        latestSnapshotId: latest.snapshotId,
        latestConfidence: latest.confidence,
        latestDisagreement: latest.disagreement,
        latestSelectedCandidateId: latest.selectedCandidateId,
        latestHeuristicTopCandidateId: latest.heuristicTopCandidateId,
        latestLearnedTopCandidateId: latest.learnedTopCandidateId,
        latestReason: latest.reason,
    };
}

function roundValue(value, digits = 6) {
    return typeof value === "number" && Number.isFinite(value)
        ? Number(value.toFixed(digits))
        : undefined;
}

function buildFeedbackTrainingWeight(reviewSignals) {
    let weight = 1;
    const approvalStatus = toTrimmed(reviewSignals?.approvalStatus);
    if (approvalStatus === "approved") {
        weight += 1.5;
    } else if (approvalStatus === "rejected") {
        weight *= 0.35;
    }

    const appealScore = toNumber(reviewSignals?.appealScore);
    if (appealScore !== undefined) {
        weight += Math.min(Math.max(appealScore / 10, 0), 1.25);
    }

    if (Boolean(reviewSignals?.selectedAttemptWasRetry)) {
        weight += 0.35;
    }

    return roundValue(Math.min(Math.max(weight, 0.2), 4), 6);
}

function preferenceScore(example) {
    let score = 0;
    if (example?.labels?.selectedWithinGroup) {
        score += 1000;
    }
    if (example?.labels?.finalSelectedAttempt) {
        score += 100;
    }
    if (example?.labels?.approvedOutcome) {
        score += 50;
    }
    if (example?.labels?.rejectedOutcome) {
        score -= 50;
    }

    score += toNumber(example?.labels?.appealScore) ?? 0;
    score += (toNumber(example?.labels?.pairwiseWins) ?? 0) * 5;
    score -= (toNumber(example?.labels?.pairwiseLosses) ?? 0) * 5;
    return score;
}

function sortExamplesByOracle(groupExamples) {
    return [...groupExamples].sort((left, right) => {
        const scoreDelta = preferenceScore(right) - preferenceScore(left);
        if (Math.abs(scoreDelta) > 0.0001) {
            return scoreDelta;
        }

        const leftAttempt = toNumber(left?.attempt) ?? 0;
        const rightAttempt = toNumber(right?.attempt) ?? 0;
        return leftAttempt - rightAttempt || toTrimmed(left?.candidateId).localeCompare(toTrimmed(right?.candidateId));
    });
}

function buildSearchCandidateSummary(example, candidateBundle) {
    const candidateManifest = candidateBundle?.candidateManifest ?? {};
    const shadowReranker = candidateManifest?.shadowReranker ?? candidateBundle?.summary?.shadowReranker ?? {};
    const proposalEvidence = example?.proposalEvidence
        ?? buildProposalEvidenceSummary(candidateManifest?.proposalEvidence ?? candidateBundle?.summary?.proposalEvidence);
    const proposalWarningSignals = example?.proposalWarningSignals
        ?? (proposalEvidence ? buildProposalWarningSignals(proposalEvidence) : undefined);
    const symbolicArtifacts = example?.symbolicArtifacts
        ?? buildArtifactSummary(candidateBundle?.sectionArtifacts, candidateManifest?.compositionPlan, null);

    return {
        candidateId: toTrimmed(example?.candidateId) || toTrimmed(candidateBundle?.candidateId) || undefined,
        attempt: toNumber(example?.attempt ?? candidateManifest?.attempt ?? candidateBundle?.summary?.attempt),
        selectedWithinGroup: Boolean(example?.labels?.selectedWithinGroup ?? candidateManifest?.selected ?? candidateBundle?.summary?.selected),
        worker: toTrimmed(example?.worker ?? candidateManifest?.worker ?? candidateBundle?.summary?.worker) || undefined,
        provider: toTrimmed(example?.provider ?? candidateManifest?.provider ?? candidateBundle?.summary?.provider) || undefined,
        model: toTrimmed(example?.model ?? candidateManifest?.model ?? candidateBundle?.summary?.model) || undefined,
        structurePassed: Boolean(example?.structure?.passed ?? candidateManifest?.structureEvaluation?.passed),
        structureScore: toNumber(example?.structure?.score ?? candidateManifest?.structureEvaluation?.score),
        heuristicRank: toNumber(shadowReranker?.heuristicRank),
        heuristicScore: toNumber(shadowReranker?.heuristicScore),
        learnedRank: toNumber(shadowReranker?.learnedRank),
        learnedScore: toNumber(shadowReranker?.learnedScore),
        learnedConfidence: toNumber(shadowReranker?.learnedConfidence),
        disagreesWithHeuristic: Boolean(shadowReranker?.disagreesWithHeuristic),
        proposalEvidence,
        ...(proposalWarningSignals ? { proposalWarningSignals } : {}),
        lineage: example?.lineage ?? undefined,
        reviewSignals: example?.reviewSignals ?? undefined,
        labels: example?.labels ?? undefined,
        featureAvailability: example?.featureAvailability ?? undefined,
        symbolicArtifacts,
        artifacts: {
            candidateManifestPath: candidateBundle?.candidateManifestPath,
            sectionArtifactsPath: fs.existsSync(candidateBundle?.sectionArtifactsPath ?? "") ? candidateBundle.sectionArtifactsPath : undefined,
            rerankerScorePath: fs.existsSync(candidateBundle?.rerankerScorePath ?? "") ? candidateBundle.rerankerScorePath : undefined,
            midiPath: fs.existsSync(candidateBundle?.midiPath ?? "") ? candidateBundle.midiPath : undefined,
        },
    };
}

function buildSearchPairwiseDeltas(winner, loser) {
    return {
        structureScoreDelta: toNumber(winner?.structureScore) !== undefined && toNumber(loser?.structureScore) !== undefined
            ? roundValue((toNumber(winner.structureScore) ?? 0) - (toNumber(loser.structureScore) ?? 0), 6)
            : undefined,
        phraseBreathCueDelta: roundValue(
            (toNumber(winner?.symbolicArtifacts?.phraseBreathCueCount) ?? 0)
            - (toNumber(loser?.symbolicArtifacts?.phraseBreathCueCount) ?? 0),
            6,
        ),
        harmonicColorCueDelta: roundValue(
            (toNumber(winner?.symbolicArtifacts?.harmonicColorCueCount) ?? 0)
            - (toNumber(loser?.symbolicArtifacts?.harmonicColorCueCount) ?? 0),
            6,
        ),
        proposalConfidenceDelta: roundValue(
            (toNumber(winner?.proposalEvidence?.confidence) ?? 0)
            - (toNumber(loser?.proposalEvidence?.confidence) ?? 0),
            6,
        ),
        proposalWarningCountDelta: roundValue(
            (toNumber(winner?.proposalWarningSignals?.normalizationWarningCount) ?? 0)
            - (toNumber(loser?.proposalWarningSignals?.normalizationWarningCount) ?? 0),
            6,
        ),
        roleCollapseWarningCountDelta: roundValue(
            (toNumber(winner?.proposalWarningSignals?.roleCollapseWarningCount) ?? 0)
            - (toNumber(loser?.proposalWarningSignals?.roleCollapseWarningCount) ?? 0),
            6,
        ),
        retryingWinner: Boolean(winner?.featureAvailability?.hasInputDirectiveContext),
        retryingLoser: Boolean(loser?.featureAvailability?.hasInputDirectiveContext),
        targetedRewriteWinner: Boolean(
            toTrimmed(winner?.proposalEvidence?.generationMode) === "targeted_section_rewrite"
            || winner?.featureAvailability?.hasTargetedRewriteContext,
        ),
        targetedRewriteLoser: Boolean(
            toTrimmed(loser?.proposalEvidence?.generationMode) === "targeted_section_rewrite"
            || loser?.featureAvailability?.hasTargetedRewriteContext,
        ),
    };
}

function buildSearchRerankerRows(manifestBundles, groupedExamples, support) {
    const exclusionCounts = {
        audio_only: 0,
        invalid_manifest: 0,
        no_candidate_groups: 0,
    };
    const groupRows = [];
    const pairwiseRows = [];
    const shortlistRows = [];

    for (const bundle of manifestBundles) {
        if (!bundle) {
            exclusionCounts.invalid_manifest += 1;
            continue;
        }

        const manifest = bundle.manifest ?? {};
        const workflow = toTrimmed(manifest.meta?.workflow);
        if (workflow === "audio_only") {
            exclusionCounts.audio_only += 1;
            continue;
        }

        if (!Array.isArray(bundle.candidateBundles) || bundle.candidateBundles.length < 2) {
            exclusionCounts.no_candidate_groups += 1;
            continue;
        }

        const groupId = buildGroupId(manifest);
        const groupExamples = groupedExamples.get(groupId) ?? [];
        if (groupExamples.length < 2) {
            exclusionCounts.no_candidate_groups += 1;
            continue;
        }

        const { selectedAttempt, selectedCandidateId, selectedCandidateBundle } = resolveSelectedCandidateContext(bundle);
        const selectedCandidateManifest = selectedCandidateBundle?.candidateManifest ?? {};
        const selectedProposalEvidence = buildProposalEvidenceSummary(
            selectedCandidateManifest?.proposalEvidence
            ?? selectedCandidateBundle?.summary?.proposalEvidence
            ?? manifest?.proposalEvidence,
        );
        const selectedInputDirectiveContext = buildInputDirectiveContext(
            manifest,
            selectedAttempt,
            selectedCandidateManifest?.revisionDirectives,
        );
        const reviewSignals = buildReviewSignals(manifest, selectedAttempt, selectedInputDirectiveContext, selectedCandidateBundle);
        const reviewTier = deriveReviewTier(manifest.approvalStatus, reviewSignals, true);
        const reviewedWinnerCandidateId = toTrimmed(reviewSignals?.approvalStatus) === "approved"
            ? selectedCandidateId
            : undefined;
        const orderedExamples = sortExamplesByOracle(groupExamples);
        const exampleByCandidateId = new Map(groupExamples.map((entry) => [toTrimmed(entry?.candidateId), entry]));
        const rerankerCarrier = selectedCandidateBundle?.rerankerScore
            ?? bundle.candidateBundles.find((entry) => entry?.rerankerScore)?.rerankerScore
            ?? null;
        const promotion = selectedCandidateManifest?.rerankerPromotion ?? bundle.candidateIndex?.rerankerPromotion ?? null;
        const heuristicTopCandidateId = toTrimmed(rerankerCarrier?.disagreement?.heuristicTopCandidateId)
            || toTrimmed(promotion?.heuristicTopCandidateId)
            || selectedCandidateId;
        const learnedTopCandidateId = toTrimmed(rerankerCarrier?.disagreement?.learnedTopCandidateId)
            || toTrimmed(promotion?.learnedTopCandidateId)
            || selectedCandidateId;
        const candidateSummaries = bundle.candidateBundles
            .map((candidateBundle) => buildSearchCandidateSummary(
                exampleByCandidateId.get(toTrimmed(candidateBundle?.candidateId)),
                candidateBundle,
            ));
        const promptHash = toTrimmed(selectedCandidateManifest?.meta?.promptHash)
            || toTrimmed(manifest?.meta?.promptHash)
            || toTrimmed(exampleByCandidateId.get(selectedCandidateId)?.lineage?.promptHash)
            || undefined;
        const plannerPlanSignature = toTrimmed(manifest?.meta?.plannerTelemetry?.planSignature) || undefined;
        const proposalPlanSignature = toTrimmed(selectedProposalEvidence?.planSignature) || undefined;
        const sourceArtifacts = {
            manifestPath: bundle.manifestPath,
            candidateIndexPath: fs.existsSync(bundle.candidateIndexPath) ? bundle.candidateIndexPath : undefined,
            operatorActionsLatestPath: support.operatorActionIndex.recordsBySongId.get(bundle.songId)?.length
                ? support.operatorActionIndex.latestPath
                : undefined,
            operatorActionsHistoryDir: support.operatorActionIndex.recordsBySongId.get(bundle.songId)?.length
                ? support.operatorActionIndex.historyDir
                : undefined,
            runtimeShadowHistoryDir: support.runtimeShadowIndex.entriesBySongId.get(bundle.songId)?.length
                ? support.runtimeShadowIndex.historyDir
                : undefined,
        };
        const createdAt = candidateSummaries.reduce((latest, candidate) => {
            const timestamp = Date.parse(candidate?.attempt ? exampleByCandidateId.get(candidate.candidateId)?.createdAt : "") || 0;
            const latestTimestamp = Date.parse(latest) || 0;
            return timestamp > latestTimestamp
                ? (exampleByCandidateId.get(candidate.candidateId)?.createdAt || latest)
                : latest;
        }, toTrimmed(manifest.updatedAt) || new Date(0).toISOString());
        const lane = toTrimmed(selectedProposalEvidence?.lane) || undefined;
        const reviewAudit = buildReviewAuditSummary(bundle.songId, support.operatorActionIndex);
        const runtimeShadow = buildRuntimeShadowSummary(bundle.songId, support.runtimeShadowIndex);

        groupRows.push({
            datasetVersion: "axiom_search_reranker_v1",
            rowType: "group",
            rowId: stableHash([groupId, bundle.songId, "group"]),
            groupId,
            songId: bundle.songId,
            createdAt,
            source: toTrimmed(manifest.meta?.source) || "api",
            workflow: workflow || "symbolic_only",
            reviewTier,
            promptHash,
            plannerPlanSignature,
            proposalPlanSignature,
            lane,
            selectedCandidateId,
            heuristicTopCandidateId,
            learnedTopCandidateId,
            reviewedWinnerCandidateId,
            candidateCount: candidateSummaries.length,
            attempts: uniqueStrings(candidateSummaries.map((candidate) => String(candidate?.attempt ?? ""))),
            reviewSignals,
            ...(reviewAudit ? { reviewAudit } : {}),
            ...(runtimeShadow ? { runtimeShadow } : {}),
            ...(promotion
                ? {
                    promotion: {
                        applied: true,
                        lane: toTrimmed(promotion.lane) || undefined,
                        snapshotId: toTrimmed(promotion.snapshotId) || undefined,
                        confidence: toNumber(promotion.confidence),
                        heuristicTopCandidateId: toTrimmed(promotion.heuristicTopCandidateId) || undefined,
                        learnedTopCandidateId: toTrimmed(promotion.learnedTopCandidateId) || undefined,
                        heuristicAttempt: toNumber(promotion.heuristicAttempt),
                        learnedAttempt: toNumber(promotion.learnedAttempt),
                        appliedAt: toTrimmed(promotion.appliedAt) || undefined,
                        reason: toTrimmed(promotion.reason) || undefined,
                    },
                }
                : { promotion: { applied: false } }),
            candidates: candidateSummaries,
            sourceArtifacts,
        });

        const labelSource = reviewedWinnerCandidateId
            ? "reviewed_approved_selection"
            : selectedCandidateId
                ? "runtime_selected"
                : "heuristic_fallback";
        const orderedCandidateSummaries = orderedExamples
            .map((example) => candidateSummaries.find((candidate) => candidate.candidateId === toTrimmed(example?.candidateId)))
            .filter(Boolean);

        for (let winnerIndex = 0; winnerIndex < orderedCandidateSummaries.length - 1; winnerIndex += 1) {
            for (let loserIndex = winnerIndex + 1; loserIndex < orderedCandidateSummaries.length; loserIndex += 1) {
                const winner = orderedCandidateSummaries[winnerIndex];
                const loser = orderedCandidateSummaries[loserIndex];
                pairwiseRows.push({
                    datasetVersion: "axiom_search_reranker_v1",
                    rowType: "pairwise",
                    rowId: stableHash([groupId, winner.candidateId, loser.candidateId, "pairwise"]),
                    groupId,
                    songId: bundle.songId,
                    createdAt,
                    source: toTrimmed(manifest.meta?.source) || "api",
                    workflow: workflow || "symbolic_only",
                    reviewTier,
                    promptHash,
                    plannerPlanSignature,
                    proposalPlanSignature,
                    lane,
                    winnerCandidateId: winner.candidateId,
                    loserCandidateId: loser.candidateId,
                    winnerRank: winnerIndex + 1,
                    loserRank: loserIndex + 1,
                    selectedCandidateId,
                    heuristicTopCandidateId,
                    learnedTopCandidateId,
                    reviewedWinnerCandidateId,
                    labelSource,
                    trainingWeight: buildFeedbackTrainingWeight(reviewSignals),
                    promotionApplied: Boolean(promotion),
                    reviewSignals,
                    deltas: buildSearchPairwiseDeltas(winner, loser),
                    winner,
                    loser,
                    sourceArtifacts,
                });
            }
        }

        if (reviewTier.startsWith("reviewed_")) {
            const topK = Math.min(3, orderedCandidateSummaries.length);
            shortlistRows.push({
                datasetVersion: "axiom_search_reranker_v1",
                rowType: "shortlist",
                rowId: stableHash([groupId, bundle.songId, "shortlist"]),
                groupId,
                songId: bundle.songId,
                createdAt,
                source: toTrimmed(manifest.meta?.source) || "api",
                workflow: workflow || "symbolic_only",
                reviewTier,
                promptHash,
                plannerPlanSignature,
                proposalPlanSignature,
                lane,
                topK,
                orderedCandidateIds: orderedCandidateSummaries.map((candidate) => candidate.candidateId),
                shortlistedCandidateIds: orderedCandidateSummaries.slice(0, topK).map((candidate) => candidate.candidateId),
                selectedCandidateId,
                heuristicTopCandidateId,
                learnedTopCandidateId,
                reviewedWinnerCandidateId,
                labelSource,
                promotionApplied: Boolean(promotion),
                reviewSignals,
                ...(reviewAudit ? { reviewAudit } : {}),
                ...(runtimeShadow ? { runtimeShadow } : {}),
                candidates: orderedCandidateSummaries.slice(0, topK),
                sourceArtifacts,
            });
        }
    }

    return {
        groupRows,
        pairwiseRows,
        shortlistRows,
        exclusions: exclusionCounts,
    };
}

function countRowsForSongIds(rows, songIds) {
    const songIdSet = new Set(songIds);
    return rows.filter((row) => songIdSet.has(toTrimmed(row?.songId))).length;
}

function writeSearchRerankerDataset({
    outputRoot,
    snapshotId,
    groupRows,
    pairwiseRows,
    shortlistRows,
    exclusions,
}) {
    const datasetVersion = "axiom_search_reranker_v1";
    const datasetRoot = path.join(outputRoot, "_system", "ml", "datasets", datasetVersion, snapshotId);
    const groupedBySongId = new Map();

    for (const row of groupRows) {
        const songId = toTrimmed(row?.songId) || "unknown";
        const bucket = groupedBySongId.get(songId) ?? [];
        bucket.push(row);
        groupedBySongId.set(songId, bucket);
    }

    const songIds = sortGroupedKeysChronologically(groupedBySongId);
    const splitPlan = buildKeySplitPlan(songIds, 0.7, 0.15, 0.15);
    const splitCounts = {
        trainSongs: splitPlan.train.length,
        valSongs: splitPlan.val.length,
        testSongs: splitPlan.test.length,
        trainGroups: countRowsForSongIds(groupRows, splitPlan.train),
        valGroups: countRowsForSongIds(groupRows, splitPlan.val),
        testGroups: countRowsForSongIds(groupRows, splitPlan.test),
        trainPairwiseRows: countRowsForSongIds(pairwiseRows, splitPlan.train),
        valPairwiseRows: countRowsForSongIds(pairwiseRows, splitPlan.val),
        testPairwiseRows: countRowsForSongIds(pairwiseRows, splitPlan.test),
        trainShortlistRows: countRowsForSongIds(shortlistRows, splitPlan.train),
        valShortlistRows: countRowsForSongIds(shortlistRows, splitPlan.val),
        testShortlistRows: countRowsForSongIds(shortlistRows, splitPlan.test),
    };
    const createdAtValues = groupRows.map((row) => toTrimmed(row?.createdAt)).filter(Boolean);
    const sortedCreatedAtValues = [...createdAtValues].sort();

    ensureDir(datasetRoot);
    writeJsonlFile(path.join(datasetRoot, "groups.jsonl"), groupRows);
    writeJsonlFile(path.join(datasetRoot, "pairwise.jsonl"), pairwiseRows);
    writeJsonlFile(path.join(datasetRoot, "shortlists.jsonl"), shortlistRows);
    writeJsonFile(path.join(datasetRoot, "splits.json"), {
        splitKey: "songId",
        grouping: "songId-based chronological split with candidate-family integrity",
        train: splitPlan.train,
        val: splitPlan.val,
        test: splitPlan.test,
        splitCounts,
        notes: [
            "All rows from the same songId stay in the same partition.",
            "Candidate families and all derived pairwise or shortlist rows stay attached to the same song split.",
            "The search dataset keeps structure_rank_v1 candidate rows as one slice, not the entire product surface.",
        ],
    });

    const manifest = {
        ok: true,
        datasetVersion,
        snapshotId,
        outputRoot,
        datasetRoot,
        exportedAt: new Date().toISOString(),
        sourceManifestCount: songIds.length,
        groupCount: groupRows.length,
        pairwiseCount: pairwiseRows.length,
        shortlistCount: shortlistRows.length,
        reviewTierCounts: {
            groups: summarizeReviewTiers(groupRows),
            pairwise: summarizeReviewTiers(pairwiseRows),
            shortlists: summarizeReviewTiers(shortlistRows),
        },
        sourceDateRange: {
            earliestCreatedAt: sortedCreatedAtValues[0] || null,
            latestCreatedAt: sortedCreatedAtValues[sortedCreatedAtValues.length - 1] || null,
        },
        splitCounts,
        exclusions,
        splitPolicy: {
            grouping: "songId-based chronological split with candidate-family integrity",
            train: 0.7,
            val: 0.15,
            test: 0.15,
            notes: [
                "All rows from the same songId stay in the same partition.",
                "Pairwise and shortlist rows inherit the songId partition of their parent candidate family.",
                "Prompt-hash and plan-signature leakage is reduced by keeping the entire song family together.",
            ],
        },
    };

    writeJsonFile(path.join(datasetRoot, "manifest.json"), manifest);
    return manifest;
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

export function exportStructureRerankerDataset({ outputRoot, snapshotId } = {}) {
    const effectiveOutputRoot = toTrimmed(outputRoot) || resolveOutputRoot();
    const effectiveSnapshotId = toTrimmed(snapshotId) || resolveSnapshotId();
    const datasetVersion = "structure_rank_v1";
    const datasetRoot = path.join(effectiveOutputRoot, "_system", "ml", "datasets", "structure-rank-v1", effectiveSnapshotId);
    const operatorActionIndex = loadOperatorActionAuditIndex(effectiveOutputRoot);
    const runtimeShadowIndex = loadRuntimeShadowHistoryIndex(effectiveOutputRoot);

    const exclusionCounts = {
        audio_only: 0,
        no_structure_attempts: 0,
        invalid_manifest: 0,
    };

    const manifestBundles = loadManifestBundles(effectiveOutputRoot);

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

    const backboneDataset = exportBackbonePieceDataset({
        outputRoot: effectiveOutputRoot,
        snapshotId: effectiveSnapshotId,
        manifestBundles,
    });
    const localizedRewriteDataset = exportLocalizedRewriteDataset({
        outputRoot: effectiveOutputRoot,
        snapshotId: effectiveSnapshotId,
        manifestBundles,
    });
    const searchRerankerDataset = writeSearchRerankerDataset({
        outputRoot: effectiveOutputRoot,
        snapshotId: effectiveSnapshotId,
        ...buildSearchRerankerRows(manifestBundles, groupedExamples, {
            operatorActionIndex,
            runtimeShadowIndex,
        }),
    });

    const datasetManifest = {
        ok: true,
        datasetVersion,
        snapshotId: effectiveSnapshotId,
        outputRoot: effectiveOutputRoot,
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
        reviewTierCounts: summarizeReviewTiers(examples),
        sourceDateRange: buildSourceDateRangeFromRows(examples),
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
        additionalDatasets: {
            axiom_backbone_piece_v1: {
                datasetRoot: backboneDataset.datasetRoot,
                rowCount: backboneDataset.rowCount,
                splitCounts: backboneDataset.splitCounts,
                reviewTierCounts: backboneDataset.reviewTierCounts,
                exclusions: backboneDataset.exclusions,
            },
            axiom_localized_rewrite_v1: {
                datasetRoot: localizedRewriteDataset.datasetRoot,
                rowCount: localizedRewriteDataset.rowCount,
                splitCounts: localizedRewriteDataset.splitCounts,
                reviewTierCounts: localizedRewriteDataset.reviewTierCounts,
                exclusions: localizedRewriteDataset.exclusions,
            },
            axiom_search_reranker_v1: {
                datasetRoot: searchRerankerDataset.datasetRoot,
                groupCount: searchRerankerDataset.groupCount,
                pairwiseCount: searchRerankerDataset.pairwiseCount,
                shortlistCount: searchRerankerDataset.shortlistCount,
                splitCounts: searchRerankerDataset.splitCounts,
                reviewTierCounts: searchRerankerDataset.reviewTierCounts,
                exclusions: searchRerankerDataset.exclusions,
            },
        },
    };

    writeJsonFile(path.join(datasetRoot, "manifest.json"), datasetManifest);
    return datasetManifest;
}

function run() {
    const datasetManifest = exportStructureRerankerDataset({
        outputRoot: resolveOutputRoot(),
        snapshotId: resolveSnapshotId(),
    });
    process.stdout.write(`${JSON.stringify(datasetManifest, null, 2)}\n`);
}

function isDirectExecution() {
    const scriptPath = process.argv[1];
    if (!scriptPath) {
        return false;
    }

    return import.meta.url === pathToFileURL(path.resolve(scriptPath)).href;
}

if (isDirectExecution()) {
    try {
        run();
    } catch (error) {
        fail("Failed to export structure reranker dataset", {
            message: error instanceof Error ? error.message : String(error),
        });
    }
}