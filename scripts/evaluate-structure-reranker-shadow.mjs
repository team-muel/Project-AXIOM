import fs from "node:fs"
import path from "node:path"

function readOption(name) {
    const prefix = `--${name}=`
    const exactIndex = process.argv.indexOf(`--${name}`)
    if (exactIndex >= 0) {
        return process.argv[exactIndex + 1]
    }

    const prefixed = process.argv.find((entry) => entry.startsWith(prefix))
    if (prefixed) {
        return prefixed.slice(prefix.length)
    }

    return undefined
}

function fail(message, details) {
    const payload = { ok: false, message, details }
    console.error(JSON.stringify(payload, null, 2))
    process.exit(1)
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true })
}

function writeJsonFile(filePath, value) {
    ensureDir(path.dirname(filePath))
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function writeJsonlFile(filePath, rows) {
    ensureDir(path.dirname(filePath))
    const content = rows.map((row) => JSON.stringify(row)).join("\n")
    fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf8")
}

function loadJsonIfExists(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
        return fallback
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"))
    } catch {
        return fallback
    }
}

function loadJsonl(filePath) {
    if (!fs.existsSync(filePath)) {
        return []
    }

    return fs.readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line))
}

function toTrimmed(value) {
    return String(value ?? "").trim()
}

function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : undefined
    }

    return undefined
}

function round(value, digits = 6) {
    return Number((value ?? 0).toFixed(digits))
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value))
}

function sigmoid(value) {
    const bounded = clamp(value, -20, 20)
    return 1 / (1 + Math.exp(-bounded))
}

function resolveOutputRoot() {
    return toTrimmed(readOption("root") || process.env.OUTPUT_DIR || "outputs") || "outputs"
}

function resolveSnapshotId() {
    return toTrimmed(readOption("snapshot") || "")
}

function resolveDatasetRoot(outputRoot, snapshotId) {
    return path.join(outputRoot, "_system", "ml", "datasets", "structure-rank-v1", snapshotId)
}

function resolveEvaluationRoot(outputRoot, snapshotId) {
    return path.join(outputRoot, "_system", "ml", "evaluations", "structure-rank-v1", snapshotId)
}

function normalizeScore(value) {
    const numeric = toNumber(value) ?? 0
    if (Math.abs(numeric) <= 1) {
        return numeric
    }
    return clamp(numeric / 100, -3, 3)
}

function normalizeMetricValue(value) {
    const numeric = toNumber(value)
    if (numeric === undefined) {
        return 0
    }

    if (Math.abs(numeric) <= 1.5) {
        return clamp(numeric, -3, 3)
    }

    if (Math.abs(numeric) <= 100) {
        return clamp(numeric / 100, -3, 3)
    }

    return clamp(numeric / 1000, -3, 3)
}

function normalizeCount(value, scale = 6) {
    return clamp((toNumber(value) ?? 0) / scale, -3, 3)
}

function addCategoricalFeature(featureMap, prefix, value) {
    const normalized = toTrimmed(value)
    if (!normalized) {
        return
    }

    featureMap[`${prefix}:${normalized}`] = 1
}

function uniqueStrings(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => toTrimmed(value))
        .filter(Boolean))]
}

function normalizeWarningList(values) {
    return (Array.isArray(values) ? values : [])
        .map((value) => toTrimmed(value))
        .filter(Boolean)
}

function countRoleCollapseWarnings(values) {
    return normalizeWarningList(values)
        .filter((value) => value.toLowerCase().includes("role collapse"))
        .length
}

function normalizeLineage(example) {
    const lineage = example.lineage && typeof example.lineage === "object"
        ? example.lineage
        : {}

    return {
        inputDirectiveKinds: uniqueStrings(lineage.inputDirectiveKinds),
        inputDirectiveSectionIds: uniqueStrings(lineage.inputDirectiveSectionIds),
        retryLocalization: toTrimmed(lineage.retryLocalization) || "none",
        retriedFromAttempt: toNumber(lineage.retriedFromAttempt),
    }
}

function normalizeReviewSignals(example) {
    const reviewSignals = example.reviewSignals && typeof example.reviewSignals === "object"
        ? example.reviewSignals
        : {}
    const fallbackApprovalStatus = example.labels?.approvedOutcome
        ? "approved"
        : (example.labels?.rejectedOutcome ? "rejected" : "")

    return {
        approvalStatus: toTrimmed(reviewSignals.approvalStatus) || fallbackApprovalStatus,
        note: toTrimmed(reviewSignals.note),
        appealScore: toNumber(reviewSignals.appealScore ?? example.labels?.appealScore),
        strongestDimension: toTrimmed(reviewSignals.strongestDimension ?? example.labels?.strongestDimension),
        weakestDimension: toTrimmed(reviewSignals.weakestDimension ?? example.labels?.weakestDimension),
        comparisonReference: toTrimmed(reviewSignals.comparisonReference),
        selectedAttemptWasRetry: Boolean(reviewSignals.selectedAttemptWasRetry) || (toNumber(example.attempt) ?? 1) > 1,
    }
}

function hasConcreteReviewSignals(reviewSignals) {
    return Boolean(
        toTrimmed(reviewSignals?.approvalStatus)
        || toTrimmed(reviewSignals?.note)
        || toNumber(reviewSignals?.appealScore) !== undefined
        || toTrimmed(reviewSignals?.strongestDimension)
        || toTrimmed(reviewSignals?.weakestDimension)
        || toTrimmed(reviewSignals?.comparisonReference),
    )
}

function feedbackPairWeight(example) {
    const reviewSignals = normalizeReviewSignals(example)
    let weight = 1

    if (reviewSignals.approvalStatus === "approved") {
        weight += 1.5
    } else if (reviewSignals.approvalStatus === "rejected") {
        weight *= 0.35
    }

    if (reviewSignals.appealScore !== undefined) {
        weight += clamp(reviewSignals.appealScore / 10, 0, 1.25)
    }

    if (reviewSignals.selectedAttemptWasRetry) {
        weight += 0.35
    }

    return round(clamp(weight, 0.2, 4), 6)
}

function isFeedbackFeatureName(feature) {
    return feature === "hasInputDirectiveContext"
        || feature === "retryingCandidate"
        || feature === "retryDirectiveCount"
        || feature === "inputDirectiveSectionDensity"
        || feature === "retriedFromAttempt"
        || feature.startsWith("retryLocalization:")
        || feature.startsWith("inputDirectiveKind:")
}

function stableCompareExamples(left, right) {
    const attemptDelta = (toNumber(left?.attempt) ?? 0) - (toNumber(right?.attempt) ?? 0)
    if (attemptDelta !== 0) {
        return attemptDelta
    }

    return toTrimmed(left?.candidateId).localeCompare(toTrimmed(right?.candidateId))
}

function preferenceScore(example) {
    let score = 0
    if (example.labels?.selectedWithinGroup) {
        score += 1000
    }
    if (example.labels?.finalSelectedAttempt) {
        score += 100
    }
    if (example.labels?.approvedOutcome) {
        score += 50
    }
    if (example.labels?.rejectedOutcome) {
        score -= 50
    }

    score += toNumber(example.labels?.appealScore) ?? 0
    score += (toNumber(example.labels?.pairwiseWins) ?? 0) * 5
    score -= (toNumber(example.labels?.pairwiseLosses) ?? 0) * 5
    return score
}

function compareOracleExamples(left, right) {
    const scoreDelta = preferenceScore(left) - preferenceScore(right)
    if (Math.abs(scoreDelta) > 0.0001) {
        return scoreDelta
    }

    return -stableCompareExamples(left, right)
}

function sortGroupByOracle(group) {
    return [...group].sort((left, right) => {
        const comparison = compareOracleExamples(right, left)
        if (Math.abs(comparison) > 0.0001) {
            return comparison > 0 ? 1 : -1
        }
        return stableCompareExamples(left, right)
    })
}

function collectComparableGroups(rows) {
    const grouped = new Map()
    for (const row of rows) {
        const groupId = toTrimmed(row?.groupId)
        if (!groupId) {
            continue
        }

        const bucket = grouped.get(groupId) ?? []
        bucket.push(row)
        grouped.set(groupId, bucket)
    }

    return [...grouped.values()]
        .map((group) => group.sort(stableCompareExamples))
        .filter((group) => {
            if (group.length < 2) {
                return false
            }

            const ordered = sortGroupByOracle(group)
            return preferenceScore(ordered[0]) > preferenceScore(ordered[1])
        })
}

function buildFeatureMap(example, options = {}) {
    const featureMap = {}
    const feedbackAwareMode = options?.mode === "feedback_aware"
    const sectionCount = Math.max(1, toNumber(example.planSummary?.sectionCount) ?? 1)
    const weakestSections = Array.isArray(example.structure?.weakestSections) ? example.structure.weakestSections : []
    const proposalWarningSignals = example.proposalWarningSignals && typeof example.proposalWarningSignals === "object"
        ? example.proposalWarningSignals
        : {}
    const proposalEvidence = example.proposalEvidence && typeof example.proposalEvidence === "object"
        ? example.proposalEvidence
        : {}
    const proposalSummary = proposalEvidence.summary && typeof proposalEvidence.summary === "object"
        ? proposalEvidence.summary
        : {}
    const proposalWarnings = normalizeWarningList(proposalEvidence.normalizationWarnings)
    const proposalWarningCount = toNumber(proposalWarningSignals.normalizationWarningCount)
        ?? (proposalWarnings.length || (toNumber(proposalEvidence.normalizationWarningCount) ?? 0))
    const roleCollapseWarningCount = toNumber(proposalWarningSignals.roleCollapseWarningCount)
        ?? countRoleCollapseWarnings(proposalWarnings)
    const weakestScores = weakestSections
        .map((entry) => normalizeScore(entry?.score))
        .filter((value) => Number.isFinite(value))
    const weakestIssues = weakestSections.reduce((sum, entry) => sum + (entry?.topIssue ? 1 : 0), 0)
    const lineage = normalizeLineage(example)
    const hasProposalNormalizationWarnings = typeof example.featureAvailability?.hasProposalNormalizationWarnings === "boolean"
        ? example.featureAvailability.hasProposalNormalizationWarnings
        : proposalWarningCount > 0
    const hasProposalRoleCollapseWarnings = typeof example.featureAvailability?.hasProposalRoleCollapseWarnings === "boolean"
        ? example.featureAvailability.hasProposalRoleCollapseWarnings
        : roleCollapseWarningCount > 0

    featureMap.bias = 1
    featureMap.structurePassed = example.structure?.passed ? 1 : 0
    featureMap.structureScore = normalizeScore(example.structure?.score)
    featureMap.issueCount = normalizeCount(example.structure?.issues?.length)
    featureMap.strengthCount = normalizeCount(example.structure?.strengths?.length)
    featureMap.sectionCount = clamp(sectionCount / 16, 0, 3)
    featureMap.sectionRoleCount = normalizeCount(example.planSummary?.sectionRoles?.length)
    featureMap.counterpointModeCount = normalizeCount(example.planSummary?.counterpointModes?.length)
    featureMap.harmonicColorTagCount = normalizeCount(example.planSummary?.harmonicColorTags?.length)
    featureMap.longSpanRequested = example.planSummary?.longSpanRequested ? 1 : 0
    featureMap.workflowSymbolicPlusAudio = example.workflow === "symbolic_plus_audio" ? 1 : 0
    featureMap.sourceAutonomy = example.source === "autonomy" ? 1 : 0
    featureMap.weakestSectionCount = normalizeCount(weakestSections.length)
    featureMap.weakestIssueCount = normalizeCount(weakestIssues)
    featureMap.weakestMinScore = weakestScores.length ? Math.min(...weakestScores) : normalizeScore(example.structure?.score)
    featureMap.weakestAvgScore = weakestScores.length
        ? weakestScores.reduce((sum, value) => sum + value, 0) / weakestScores.length
        : normalizeScore(example.structure?.score)
    featureMap.sectionArtifactCoverage = clamp((toNumber(example.symbolicArtifacts?.sectionArtifactCount) ?? 0) / sectionCount, 0, 3)
    featureMap.sectionTonalityCoverage = clamp((toNumber(example.symbolicArtifacts?.sectionTonalityCount) ?? 0) / sectionCount, 0, 3)
    featureMap.phraseBreathCueDensity = clamp((toNumber(example.symbolicArtifacts?.phraseBreathCueCount) ?? 0) / sectionCount, 0, 3)
    featureMap.tempoMotionCueDensity = clamp((toNumber(example.symbolicArtifacts?.tempoMotionCueCount) ?? 0) / sectionCount, 0, 3)
    featureMap.ornamentCueDensity = clamp((toNumber(example.symbolicArtifacts?.ornamentCueCount) ?? 0) / sectionCount, 0, 3)
    featureMap.harmonicColorCueDensity = clamp((toNumber(example.symbolicArtifacts?.harmonicColorCueCount) ?? 0) / sectionCount, 0, 3)
    featureMap.hasSectionArtifacts = example.featureAvailability?.hasSectionArtifacts ? 1 : 0
    featureMap.hasExpressionPlan = example.featureAvailability?.hasExpressionPlan ? 1 : 0
    featureMap.hasCompositionPlan = example.featureAvailability?.hasCompositionPlan ? 1 : 0
    featureMap.hasAttemptWeakestSections = example.featureAvailability?.hasAttemptWeakestSections ? 1 : 0
    featureMap.hasProposalEvidence = example.featureAvailability?.hasProposalEvidence ? 1 : 0
    featureMap.hasLearnedProposalEvidence = example.featureAvailability?.hasLearnedProposalEvidence ? 1 : 0
    featureMap.hasProposalLane = example.featureAvailability?.hasProposalLane ? 1 : 0
    featureMap.hasProposalSummary = example.featureAvailability?.hasProposalSummary ? 1 : 0
    featureMap.hasProposalNormalizationWarnings = hasProposalNormalizationWarnings ? 1 : 0
    featureMap.hasProposalRoleCollapseWarnings = hasProposalRoleCollapseWarnings ? 1 : 0
    featureMap.selectedAttemptFeatureRich = example.featureAvailability?.selectedAttemptFeatureRich ? 1 : 0
    featureMap.longSpanAverageFit = normalizeMetricValue(example.structure?.longSpan?.averageFit)
    featureMap.longSpanHeld = toTrimmed(example.structure?.longSpan?.status) === "held" ? 1 : 0
    featureMap.longSpanAtRisk = toTrimmed(example.structure?.longSpan?.status) === "at_risk" ? 1 : 0
    featureMap.longSpanCollapsed = toTrimmed(example.structure?.longSpan?.status) === "collapsed" ? 1 : 0
    featureMap.orchestrationIdiomaticRangeFit = normalizeMetricValue(example.structure?.orchestration?.idiomaticRangeFit)
    featureMap.orchestrationRegisterBalanceFit = normalizeMetricValue(example.structure?.orchestration?.registerBalanceFit)
    featureMap.orchestrationConversationFit = normalizeMetricValue(example.structure?.orchestration?.ensembleConversationFit)
    featureMap.orchestrationDoublingFit = normalizeMetricValue(example.structure?.orchestration?.doublingPressureFit)
    featureMap.orchestrationHandoffFit = normalizeMetricValue(example.structure?.orchestration?.sectionHandoffFit)
    featureMap.proposalConfidence = normalizeMetricValue(proposalEvidence.confidence)
    featureMap.proposalNormalizationWarningCount = normalizeCount(proposalWarningCount, 4)
    featureMap.proposalRoleCollapseWarningCount = normalizeCount(roleCollapseWarningCount, 4)
    featureMap.proposalSummaryPartCount = normalizeCount(proposalSummary.partCount, 4)
    featureMap.proposalSummaryMeasureCount = clamp((toNumber(proposalSummary.measureCount) ?? 0) / 32, 0, 3)
    featureMap.proposalSummaryNoteCount = clamp((toNumber(proposalSummary.noteCount) ?? 0) / 96, 0, 3)

    addCategoricalFeature(featureMap, "proposalWorker", proposalEvidence.worker)
    addCategoricalFeature(featureMap, "proposalLane", proposalEvidence.lane)
    addCategoricalFeature(featureMap, "proposalGenerationMode", proposalEvidence.generationMode)

    const metrics = typeof example.structure?.metrics === "object" && example.structure.metrics
        ? example.structure.metrics
        : {}
    for (const [key, value] of Object.entries(metrics)) {
        featureMap[`metric:${key}`] = normalizeMetricValue(value)
    }

    if (feedbackAwareMode) {
        featureMap.hasInputDirectiveContext = example.featureAvailability?.hasInputDirectiveContext ? 1 : 0
        featureMap.retryingCandidate = lineage.retriedFromAttempt !== undefined ? 1 : 0
        featureMap.retryDirectiveCount = normalizeCount(lineage.inputDirectiveKinds.length, 4)
        featureMap.inputDirectiveSectionDensity = clamp(lineage.inputDirectiveSectionIds.length / sectionCount, 0, 3)
        featureMap.retriedFromAttempt = clamp((lineage.retriedFromAttempt ?? 0) / 4, 0, 3)

        addCategoricalFeature(featureMap, "retryLocalization", lineage.retryLocalization)
        for (const kind of lineage.inputDirectiveKinds) {
            addCategoricalFeature(featureMap, "inputDirectiveKind", kind)
        }
    }

    return featureMap
}

function collectFeatureNames(rows, options = {}) {
    const names = new Set()
    for (const row of rows) {
        const featureMap = buildFeatureMap(row, options)
        for (const name of Object.keys(featureMap)) {
            names.add(name)
        }
    }
    return [...names].sort()
}

function buildDenseVector(featureMap, featureNames) {
    return featureNames.map((name) => featureMap[name] ?? 0)
}

function dot(left, right) {
    let total = 0
    for (let index = 0; index < left.length; index += 1) {
        total += (left[index] ?? 0) * (right[index] ?? 0)
    }
    return total
}

function vectorDifference(left, right) {
    return left.map((value, index) => value - (right[index] ?? 0))
}

function buildVectorCache(rows, featureNames, options = {}) {
    const cache = new Map()
    for (const row of rows) {
        cache.set(row.exampleId, buildDenseVector(buildFeatureMap(row, options), featureNames))
    }
    return cache
}

function buildWinnerLoserPairs(groups, pairWeightResolver = () => 1) {
    const pairs = []
    for (const group of groups) {
        const ordered = sortGroupByOracle(group)
        const winner = ordered[0]
        const winnerScore = preferenceScore(winner)

        for (const loser of ordered.slice(1)) {
            if (winnerScore <= preferenceScore(loser)) {
                continue
            }

            pairs.push({
                groupId: winner.groupId,
                winnerId: winner.exampleId,
                loserId: loser.exampleId,
                weight: pairWeightResolver(winner, loser, group),
            })
        }
    }
    return pairs
}

function pairwiseAccuracy(pairs, vectorCache, weights, usePairWeights = false) {
    if (pairs.length === 0) {
        return undefined
    }

    let correct = 0
    let totalWeight = 0
    for (const pair of pairs) {
        const winnerVector = vectorCache.get(pair.winnerId)
        const loserVector = vectorCache.get(pair.loserId)
        if (!winnerVector || !loserVector) {
            continue
        }

        const pairWeight = usePairWeights ? (toNumber(pair.weight) ?? 1) : 1
        const margin = dot(weights, vectorDifference(winnerVector, loserVector))
        if (margin > 0) {
            correct += pairWeight
        }
        totalWeight += pairWeight
    }

    return totalWeight > 0 ? round(correct / totalWeight, 6) : undefined
}

function trainPairwiseLinearModel(trainPairs, valPairs, vectorCache, featureNames, options = {}) {
    const weights = new Array(featureNames.length).fill(0)
    const weightingMode = toTrimmed(options?.weightingMode) || "uniform"
    const trainWeightedPairCount = trainPairs.reduce((sum, pair) => sum + (toNumber(pair.weight) ?? 1), 0)
    const valWeightedPairCount = valPairs.reduce((sum, pair) => sum + (toNumber(pair.weight) ?? 1), 0)
    if (trainPairs.length === 0) {
        return {
            weights,
            training: {
                epochs: 0,
                learningRate: 0,
                regularization: 0,
                weightingMode,
                trainPairCount: 0,
                valPairCount: valPairs.length,
                trainWeightedPairCount: round(trainWeightedPairCount, 6),
                valWeightedPairCount: round(valWeightedPairCount, 6),
                bestValPairwiseAccuracy: undefined,
                bestValWeightedPairwiseAccuracy: undefined,
                bestTrainPairwiseAccuracy: undefined,
                bestTrainWeightedPairwiseAccuracy: undefined,
            },
        }
    }

    const epochs = 80
    const learningRate = 0.75
    const regularization = 0.0025
    let bestWeights = [...weights]
    let bestValPairwiseAccuracy = -Infinity
    let bestValWeightedPairwiseAccuracy = -Infinity
    let bestTrainPairwiseAccuracy = -Infinity
    let bestTrainWeightedPairwiseAccuracy = -Infinity

    for (let epoch = 0; epoch < epochs; epoch += 1) {
        const gradient = new Array(featureNames.length).fill(0)

        for (const pair of trainPairs) {
            const winnerVector = vectorCache.get(pair.winnerId)
            const loserVector = vectorCache.get(pair.loserId)
            if (!winnerVector || !loserVector) {
                continue
            }

            const difference = vectorDifference(winnerVector, loserVector)
            const margin = dot(weights, difference)
            const scale = 1 - sigmoid(margin)
            const pairWeight = toNumber(pair.weight) ?? 1
            for (let index = 0; index < difference.length; index += 1) {
                gradient[index] += pairWeight * scale * difference[index]
            }
        }

        for (let index = 0; index < weights.length; index += 1) {
            const averagedGradient = gradient[index] / Math.max(trainWeightedPairCount, 1)
            weights[index] += learningRate * (averagedGradient - (regularization * weights[index]))
        }

        const trainAccuracy = pairwiseAccuracy(trainPairs, vectorCache, weights) ?? -Infinity
        const trainWeightedAccuracy = pairwiseAccuracy(trainPairs, vectorCache, weights, true) ?? trainAccuracy
        const valAccuracy = valPairs.length > 0
            ? (pairwiseAccuracy(valPairs, vectorCache, weights) ?? -Infinity)
            : trainAccuracy
        const valWeightedAccuracy = valPairs.length > 0
            ? (pairwiseAccuracy(valPairs, vectorCache, weights, true) ?? -Infinity)
            : trainWeightedAccuracy

        if (valWeightedAccuracy > bestValWeightedPairwiseAccuracy + 0.000001
            || (Math.abs(valWeightedAccuracy - bestValWeightedPairwiseAccuracy) <= 0.000001 && valAccuracy > bestValPairwiseAccuracy + 0.000001)
            || (Math.abs(valWeightedAccuracy - bestValWeightedPairwiseAccuracy) <= 0.000001
                && Math.abs(valAccuracy - bestValPairwiseAccuracy) <= 0.000001
                && trainWeightedAccuracy > bestTrainWeightedPairwiseAccuracy)) {
            bestWeights = [...weights]
            bestValPairwiseAccuracy = valAccuracy
            bestValWeightedPairwiseAccuracy = valWeightedAccuracy
            bestTrainPairwiseAccuracy = trainAccuracy
            bestTrainWeightedPairwiseAccuracy = trainWeightedAccuracy
        }
    }

    return {
        weights: bestWeights,
        training: {
            epochs,
            learningRate,
            regularization,
            weightingMode,
            trainPairCount: trainPairs.length,
            valPairCount: valPairs.length,
            trainWeightedPairCount: round(trainWeightedPairCount, 6),
            valWeightedPairCount: round(valWeightedPairCount, 6),
            bestValPairwiseAccuracy: Number.isFinite(bestValPairwiseAccuracy) ? round(bestValPairwiseAccuracy, 6) : undefined,
            bestValWeightedPairwiseAccuracy: Number.isFinite(bestValWeightedPairwiseAccuracy) ? round(bestValWeightedPairwiseAccuracy, 6) : undefined,
            bestTrainPairwiseAccuracy: Number.isFinite(bestTrainPairwiseAccuracy) ? round(bestTrainPairwiseAccuracy, 6) : undefined,
            bestTrainWeightedPairwiseAccuracy: Number.isFinite(bestTrainWeightedPairwiseAccuracy)
                ? round(bestTrainWeightedPairwiseAccuracy, 6)
                : undefined,
        },
    }
}

function compareScoredExamples(left, right) {
    const delta = (right?.score ?? 0) - (left?.score ?? 0)
    if (Math.abs(delta) > 0.000001) {
        return delta > 0 ? 1 : -1
    }
    return stableCompareExamples(left?.example, right?.example)
}

function fileIfExists(filePath) {
    const normalized = toTrimmed(filePath)
    return normalized && fs.existsSync(normalized) ? normalized : undefined
}

function buildFallbackEvaluation(example) {
    const weakestSections = Array.isArray(example.structure?.weakestSections)
        ? example.structure.weakestSections.map((entry) => ({
            sectionId: entry?.sectionId,
            role: entry?.role,
            score: toNumber(entry?.score) ?? 0,
            issues: entry?.topIssue ? [entry.topIssue] : [],
            strengths: [],
            metrics: typeof entry?.metrics === "object" && entry.metrics ? entry.metrics : {},
        }))
        : []

    return {
        passed: Boolean(example.structure?.passed),
        score: toNumber(example.structure?.score),
        issues: Array.isArray(example.structure?.issues) ? example.structure.issues : [],
        strengths: Array.isArray(example.structure?.strengths) ? example.structure.strengths : [],
        metrics: typeof example.structure?.metrics === "object" && example.structure.metrics ? example.structure.metrics : {},
        weakestSections,
        longSpan: example.structure?.longSpan,
        orchestration: example.structure?.orchestration,
    }
}

function hydrateStructureEvaluation(example, jsonCache) {
    const candidateManifestPath = fileIfExists(example.artifacts?.candidateManifestPath)
    if (candidateManifestPath) {
        const cached = jsonCache.get(candidateManifestPath) ?? loadJsonIfExists(candidateManifestPath, null)
        jsonCache.set(candidateManifestPath, cached)
        if (cached?.structureEvaluation) {
            return cached.structureEvaluation
        }
    }

    const manifestPath = fileIfExists(example.artifacts?.manifestPath)
    if (manifestPath && example.labels?.selectedWithinGroup) {
        const cached = jsonCache.get(manifestPath) ?? loadJsonIfExists(manifestPath, null)
        jsonCache.set(manifestPath, cached)
        if (cached?.structureEvaluation) {
            return cached.structureEvaluation
        }
    }

    return buildFallbackEvaluation(example)
}

function chooseHeuristicTop(group, selectionModule, jsonCache) {
    let bestExample = undefined
    let bestEvaluation = undefined

    for (const example of group) {
        const evaluation = hydrateStructureEvaluation(example, jsonCache)
        if (!bestExample || selectionModule.compareStructureEvaluationsForCandidateSelection(evaluation, bestEvaluation) > 0) {
            bestExample = example
            bestEvaluation = evaluation
        }
    }

    const scoredCandidates = group.map((example) => {
        const evaluation = hydrateStructureEvaluation(example, jsonCache)
        return {
            example,
            score: selectionModule.scoreStructureEvaluationForCandidateSelection(evaluation),
        }
    }).sort(compareScoredExamples)

    return {
        top: bestExample,
        heuristicMargin: scoredCandidates.length > 1 ? round(scoredCandidates[0].score - scoredCandidates[1].score, 6) : 0,
        scoredCandidates,
    }
}

function chooseLearnedTop(group, vectorCache, weights) {
    const scoredCandidates = group.map((example) => ({
        example,
        score: dot(weights, vectorCache.get(example.exampleId) ?? []),
    })).sort(compareScoredExamples)

    return {
        top: scoredCandidates[0]?.example,
        learnedMargin: scoredCandidates.length > 1 ? round(scoredCandidates[0].score - scoredCandidates[1].score, 6) : 0,
        scoredCandidates,
    }
}

function chooseCalibrationTemperature(groupResults) {
    if (groupResults.length === 0) {
        return { temperature: 1, brier: undefined }
    }

    const candidates = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
    let best = { temperature: 1, brier: Number.POSITIVE_INFINITY }

    for (const temperature of candidates) {
        const brier = groupResults.reduce((sum, result) => {
            const confidence = sigmoid(result.learnedMargin / temperature)
            const target = result.learnedCorrect ? 1 : 0
            return sum + ((confidence - target) ** 2)
        }, 0) / groupResults.length

        if (brier < best.brier) {
            best = { temperature, brier }
        }
    }

    return { temperature: best.temperature, brier: round(best.brier, 6) }
}

function buildCalibrationBins(groupResults, temperature) {
    if (groupResults.length === 0) {
        return []
    }

    const bins = [
        { minimum: 0.5, maximum: 0.6 },
        { minimum: 0.6, maximum: 0.7 },
        { minimum: 0.7, maximum: 0.8 },
        { minimum: 0.8, maximum: 0.9 },
        { minimum: 0.9, maximum: 1.01 },
    ]

    return bins.map((bin) => {
        const members = groupResults.filter((result) => {
            const confidence = sigmoid(result.learnedMargin / temperature)
            return confidence >= bin.minimum && confidence < bin.maximum
        })

        if (members.length === 0) {
            return {
                minimum: bin.minimum,
                maximum: bin.maximum,
                count: 0,
                averageConfidence: undefined,
                accuracy: undefined,
            }
        }

        const averageConfidence = members.reduce((sum, result) => sum + sigmoid(result.learnedMargin / temperature), 0) / members.length
        const accuracy = members.reduce((sum, result) => sum + (result.learnedCorrect ? 1 : 0), 0) / members.length
        return {
            minimum: bin.minimum,
            maximum: bin.maximum,
            count: members.length,
            averageConfidence: round(averageConfidence, 6),
            accuracy: round(accuracy, 6),
        }
    })
}

function buildContributionSummary(contributions) {
    if (contributions.length === 0) {
        return "no strong feature contribution surfaced"
    }

    const positive = contributions.filter((entry) => entry.contribution > 0).slice(0, 2).map((entry) => entry.feature)
    const negative = contributions.filter((entry) => entry.contribution < 0).slice(0, 1).map((entry) => entry.feature)

    if (positive.length > 0 && negative.length > 0) {
        return `learned favored ${positive.join(", ")} despite heuristic strength on ${negative.join(", ")}`
    }

    if (positive.length > 0) {
        return `learned favored ${positive.join(", ")}`
    }

    return `heuristic retained an edge on ${negative.join(", ")}`
}

function buildTopContributions(learnedExample, heuristicExample, vectorCache, featureNames, weights) {
    const learnedVector = vectorCache.get(learnedExample.exampleId) ?? []
    const heuristicVector = vectorCache.get(heuristicExample.exampleId) ?? []
    const contributions = featureNames
        .map((feature, index) => ({
            feature,
            contribution: weights[index] * ((learnedVector[index] ?? 0) - (heuristicVector[index] ?? 0)),
            learnedValue: learnedVector[index] ?? 0,
            heuristicValue: heuristicVector[index] ?? 0,
        }))
        .filter((entry) => entry.feature !== "bias" && Math.abs(entry.contribution) > 0.0001)
        .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))
        .slice(0, 5)
        .map((entry) => ({
            feature: entry.feature,
            contribution: round(entry.contribution, 6),
            learnedValue: round(entry.learnedValue, 6),
            heuristicValue: round(entry.heuristicValue, 6),
        }))

    return {
        summary: buildContributionSummary(contributions),
        topFeatures: contributions,
    }
}

function summarizeWeights(featureNames, weights) {
    const items = featureNames
        .map((feature, index) => ({ feature, weight: weights[index] ?? 0 }))
        .filter((entry) => entry.feature !== "bias" && Math.abs(entry.weight) > 0.0001)
        .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))

    return {
        topPositive: items.filter((entry) => entry.weight > 0).slice(0, 8).map((entry) => ({ feature: entry.feature, weight: round(entry.weight, 6) })),
        topNegative: items.filter((entry) => entry.weight < 0).slice(0, 8).map((entry) => ({ feature: entry.feature, weight: round(entry.weight, 6) })),
    }
}

function summarizeFeedbackFeatureWeights(featureNames, weights) {
    const items = featureNames
        .map((feature, index) => ({ feature, weight: weights[index] ?? 0 }))
        .filter((entry) => isFeedbackFeatureName(entry.feature) && Math.abs(entry.weight) > 0.0001)
        .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))

    return {
        activeFeatureCount: items.length,
        topPositive: items.filter((entry) => entry.weight > 0).slice(0, 8).map((entry) => ({ feature: entry.feature, weight: round(entry.weight, 6) })),
        topNegative: items.filter((entry) => entry.weight < 0).slice(0, 8).map((entry) => ({ feature: entry.feature, weight: round(entry.weight, 6) })),
    }
}

function buildGroupReviewContext(example) {
    const reviewSignals = normalizeReviewSignals(example)
    const lineage = normalizeLineage(example)

    return {
        reviewed: hasConcreteReviewSignals(reviewSignals),
        approvalStatus: reviewSignals.approvalStatus || undefined,
        appealScore: reviewSignals.appealScore,
        selectedAttemptWasRetry: reviewSignals.selectedAttemptWasRetry,
        retryLocalization: lineage.retryLocalization,
    }
}

function summarizeReviewSubset(groupResults, predicate) {
    const members = groupResults.filter(predicate)
    if (members.length === 0) {
        return {
            groupCount: 0,
            learnedTop1Accuracy: undefined,
            heuristicTop1Accuracy: undefined,
            learnedAppealWeightedTop1Accuracy: undefined,
            heuristicAppealWeightedTop1Accuracy: undefined,
        }
    }

    const learnedCorrect = members.reduce((sum, result) => sum + (result.learnedCorrect ? 1 : 0), 0)
    const heuristicCorrect = members.reduce((sum, result) => sum + (result.heuristicCorrect ? 1 : 0), 0)
    const appealMembers = members.filter((result) => (toNumber(result.appealScore) ?? 0) > 0)
    const totalAppealWeight = appealMembers.reduce((sum, result) => sum + (toNumber(result.appealScore) ?? 0), 0)

    return {
        groupCount: members.length,
        learnedTop1Accuracy: round(learnedCorrect / members.length, 6),
        heuristicTop1Accuracy: round(heuristicCorrect / members.length, 6),
        learnedAppealWeightedTop1Accuracy: totalAppealWeight > 0
            ? round(appealMembers.reduce((sum, result) => sum + ((toNumber(result.appealScore) ?? 0) * (result.learnedCorrect ? 1 : 0)), 0) / totalAppealWeight, 6)
            : undefined,
        heuristicAppealWeightedTop1Accuracy: totalAppealWeight > 0
            ? round(appealMembers.reduce((sum, result) => sum + ((toNumber(result.appealScore) ?? 0) * (result.heuristicCorrect ? 1 : 0)), 0) / totalAppealWeight, 6)
            : undefined,
    }
}

function summarizeReviewMetrics(groupResults) {
    return {
        reviewedGroups: summarizeReviewSubset(groupResults, (result) => result.reviewed),
        approvedReviewedGroups: summarizeReviewSubset(groupResults, (result) => result.reviewed && result.approvalStatus === "approved"),
        retryingReviewedGroups: summarizeReviewSubset(
            groupResults,
            (result) => result.reviewed && (result.selectedAttemptWasRetry || toTrimmed(result.retryLocalization) !== "none"),
        ),
    }
}

function buildComparisonMetric(scope, metric, baseline, feedbackAware, groupCount) {
    if (!Number.isFinite(baseline) || !Number.isFinite(feedbackAware) || (toNumber(groupCount) ?? 0) <= 0) {
        return null
    }

    return {
        scope,
        metric,
        baseline: round(baseline, 6),
        feedbackAware: round(feedbackAware, 6),
        delta: round(feedbackAware - baseline, 6),
        groupCount,
    }
}

function buildFeedbackComparison(staticModel, feedbackAwareModel) {
    const staticReviewMetrics = staticModel.testEvaluation.metrics.reviewMetrics
    const feedbackReviewMetrics = feedbackAwareModel.testEvaluation.metrics.reviewMetrics
    const candidateMetrics = [
        buildComparisonMetric(
            "retrying_reviewed_groups",
            "appealWeightedTop1Accuracy",
            staticReviewMetrics.retryingReviewedGroups.learnedAppealWeightedTop1Accuracy,
            feedbackReviewMetrics.retryingReviewedGroups.learnedAppealWeightedTop1Accuracy,
            feedbackReviewMetrics.retryingReviewedGroups.groupCount,
        ),
        buildComparisonMetric(
            "retrying_reviewed_groups",
            "top1Accuracy",
            staticReviewMetrics.retryingReviewedGroups.learnedTop1Accuracy,
            feedbackReviewMetrics.retryingReviewedGroups.learnedTop1Accuracy,
            feedbackReviewMetrics.retryingReviewedGroups.groupCount,
        ),
        buildComparisonMetric(
            "approved_reviewed_groups",
            "top1Accuracy",
            staticReviewMetrics.approvedReviewedGroups.learnedTop1Accuracy,
            feedbackReviewMetrics.approvedReviewedGroups.learnedTop1Accuracy,
            feedbackReviewMetrics.approvedReviewedGroups.groupCount,
        ),
        buildComparisonMetric(
            "reviewed_groups",
            "appealWeightedTop1Accuracy",
            staticReviewMetrics.reviewedGroups.learnedAppealWeightedTop1Accuracy,
            feedbackReviewMetrics.reviewedGroups.learnedAppealWeightedTop1Accuracy,
            feedbackReviewMetrics.reviewedGroups.groupCount,
        ),
        buildComparisonMetric(
            "reviewed_groups",
            "top1Accuracy",
            staticReviewMetrics.reviewedGroups.learnedTop1Accuracy,
            feedbackReviewMetrics.reviewedGroups.learnedTop1Accuracy,
            feedbackReviewMetrics.reviewedGroups.groupCount,
        ),
    ].filter(Boolean)

    const strongestImprovement = candidateMetrics
        .filter((entry) => entry.delta > 0.000001)
        .sort((left, right) => right.delta - left.delta || left.groupCount - right.groupCount)[0] ?? null
    const reviewedGroupsMetric = candidateMetrics.find((entry) => entry.scope === "reviewed_groups" && entry.metric === "appealWeightedTop1Accuracy") ?? null

    return {
        baselineMode: staticModel.mode,
        challengerMode: feedbackAwareModel.mode,
        improved: Boolean(strongestImprovement),
        narrowScopeOnly: Boolean(strongestImprovement && (!reviewedGroupsMetric || reviewedGroupsMetric.delta <= 0.000001) && strongestImprovement.scope !== "reviewed_groups"),
        strongestImprovement,
        metrics: candidateMetrics,
    }
}

function evaluateSplit(splitName, rows, vectorCache, weights, selectionModule, jsonCache, temperature, featureNames) {
    const groups = collectComparableGroups(rows)
    const pairCount = buildWinnerLoserPairs(groups).length
    const groupResults = []
    const disagreements = []

    for (const group of groups) {
        const oracle = sortGroupByOracle(group)[0]
        const learned = chooseLearnedTop(group, vectorCache, weights)
        const heuristic = chooseHeuristicTop(group, selectionModule, jsonCache)
        const learnedCorrect = learned.top?.candidateId === oracle.candidateId
        const heuristicCorrect = heuristic.top?.candidateId === oracle.candidateId
        const learnedConfidence = sigmoid(learned.learnedMargin / temperature)
        const reviewContext = buildGroupReviewContext(oracle)

        const result = {
            groupId: oracle.groupId,
            oracleCandidateId: oracle.candidateId,
            learnedCandidateId: learned.top?.candidateId,
            heuristicCandidateId: heuristic.top?.candidateId,
            learnedMargin: learned.learnedMargin,
            heuristicMargin: heuristic.heuristicMargin,
            learnedConfidence: round(learnedConfidence, 6),
            learnedCorrect,
            heuristicCorrect,
            reviewed: reviewContext.reviewed,
            approvalStatus: reviewContext.approvalStatus,
            appealScore: reviewContext.appealScore,
            selectedAttemptWasRetry: reviewContext.selectedAttemptWasRetry,
            retryLocalization: reviewContext.retryLocalization,
        }
        groupResults.push(result)

        if (learned.top && heuristic.top && learned.top.candidateId !== heuristic.top.candidateId) {
            disagreements.push({
                split: splitName,
                groupId: oracle.groupId,
                oracleCandidateId: oracle.candidateId,
                learnedCandidateId: learned.top.candidateId,
                heuristicCandidateId: heuristic.top.candidateId,
                learnedConfidence: round(learnedConfidence, 6),
                highConfidence: learnedConfidence >= 0.75,
                explanation: buildTopContributions(learned.top, heuristic.top, vectorCache, featureNames, weights),
                candidates: group.map((example) => ({
                    candidateId: example.candidateId,
                    attempt: example.attempt,
                    selectedWithinGroup: Boolean(example.labels?.selectedWithinGroup),
                    appealScore: toNumber(example.labels?.appealScore),
                    retryLocalization: toTrimmed(example.lineage?.retryLocalization) || "none",
                    inputDirectiveKinds: uniqueStrings(example.lineage?.inputDirectiveKinds),
                    learnedScore: round(dot(weights, vectorCache.get(example.exampleId) ?? []), 6),
                    heuristicScore: round(selectionModule.scoreStructureEvaluationForCandidateSelection(hydrateStructureEvaluation(example, jsonCache)), 6),
                    structureScore: toNumber(example.structure?.score),
                    passed: Boolean(example.structure?.passed),
                })),
            })
        }
    }

    const learnedCorrectCount = groupResults.reduce((sum, result) => sum + (result.learnedCorrect ? 1 : 0), 0)
    const heuristicCorrectCount = groupResults.reduce((sum, result) => sum + (result.heuristicCorrect ? 1 : 0), 0)
    const highConfidenceDisagreements = disagreements.filter((entry) => entry.highConfidence).length
    const reviewMetrics = summarizeReviewMetrics(groupResults)

    return {
        metrics: {
            candidateCount: rows.length,
            comparableGroupCount: groups.length,
            pairCount,
            learnedTop1Accuracy: groups.length > 0 ? round(learnedCorrectCount / groups.length, 6) : undefined,
            heuristicTop1Accuracy: groups.length > 0 ? round(heuristicCorrectCount / groups.length, 6) : undefined,
            disagreementCount: disagreements.length,
            highConfidenceDisagreementCount: highConfidenceDisagreements,
            averageLearnedConfidence: groups.length > 0
                ? round(groupResults.reduce((sum, result) => sum + result.learnedConfidence, 0) / groups.length, 6)
                : undefined,
            reviewMetrics,
        },
        groupResults,
        disagreements,
    }
}

function trainAndEvaluateModel({
    mode,
    trainRows,
    valRows,
    testRows,
    allRows,
    selectionModule,
    jsonCache,
}) {
    const featureOptions = { mode }
    const featureNames = collectFeatureNames(allRows, featureOptions)
    const vectorCache = buildVectorCache(allRows, featureNames, featureOptions)
    const trainGroups = collectComparableGroups(trainRows)
    const valGroups = collectComparableGroups(valRows)
    const pairWeightResolver = mode === "feedback_aware" ? feedbackPairWeight : undefined
    const trainPairs = buildWinnerLoserPairs(trainGroups, pairWeightResolver)
    const valPairs = buildWinnerLoserPairs(valGroups, pairWeightResolver)
    const { weights, training } = trainPairwiseLinearModel(
        trainPairs,
        valPairs,
        vectorCache,
        featureNames,
        { weightingMode: mode === "feedback_aware" ? "review_feedback" : "uniform" },
    )

    const preliminaryVal = evaluateSplit("val", valRows, vectorCache, weights, selectionModule, jsonCache, 1, featureNames)
    const calibration = chooseCalibrationTemperature(preliminaryVal.groupResults)
    const calibratedTemperature = calibration.temperature ?? 1

    return {
        mode,
        featureNames,
        weights,
        training,
        calibratedTemperature,
        calibration,
        modelSummary: summarizeWeights(featureNames, weights),
        feedbackFeatureSummary: summarizeFeedbackFeatureWeights(featureNames, weights),
        trainEvaluation: evaluateSplit("train", trainRows, vectorCache, weights, selectionModule, jsonCache, calibratedTemperature, featureNames),
        valEvaluation: evaluateSplit("val", valRows, vectorCache, weights, selectionModule, jsonCache, calibratedTemperature, featureNames),
        testEvaluation: evaluateSplit("test", testRows, vectorCache, weights, selectionModule, jsonCache, calibratedTemperature, featureNames),
    }
}

async function loadStructureSelectionModule() {
    try {
        return await import(new URL("../dist/pipeline/structureSelection.js", import.meta.url))
    } catch (error) {
        fail("Build artifacts missing for structure selection module", {
            message: error instanceof Error ? error.message : String(error),
            hint: "Run npm run build before ml:shadow:structure-rank.",
        })
    }
}

async function run() {
    const outputRoot = resolveOutputRoot()
    const snapshotId = resolveSnapshotId()
    if (!snapshotId) {
        fail("Missing required snapshot id", {
            hint: "Pass --snapshot <id> for a structure-rank-v1 dataset snapshot.",
        })
    }

    const datasetRoot = resolveDatasetRoot(outputRoot, snapshotId)
    const datasetManifestPath = path.join(datasetRoot, "manifest.json")
    const datasetManifest = loadJsonIfExists(datasetManifestPath, null)
    if (!datasetManifest?.datasetVersion) {
        fail("Dataset manifest missing or invalid", {
            datasetManifestPath,
        })
    }

    const trainRows = loadJsonl(path.join(datasetRoot, "train.jsonl"))
    const valRows = loadJsonl(path.join(datasetRoot, "val.jsonl"))
    const testRows = loadJsonl(path.join(datasetRoot, "test.jsonl"))
    const allRows = [...trainRows, ...valRows, ...testRows]
    if (allRows.length === 0) {
        fail("No dataset rows found", {
            datasetRoot,
        })
    }

    const selectionModule = await loadStructureSelectionModule()
    const jsonCache = new Map()
    const staticModel = trainAndEvaluateModel({
        mode: "static",
        trainRows,
        valRows,
        testRows,
        allRows,
        selectionModule,
        jsonCache,
    })
    const feedbackAwareModel = trainAndEvaluateModel({
        mode: "feedback_aware",
        trainRows,
        valRows,
        testRows,
        allRows,
        selectionModule,
        jsonCache,
    })

    const evaluationRoot = resolveEvaluationRoot(outputRoot, snapshotId)
    const reportPath = path.join(evaluationRoot, "shadow-reranker-report.json")
    const modelPath = path.join(evaluationRoot, "shadow-reranker-model.json")
    const disagreementsPath = path.join(evaluationRoot, "shadow-reranker-disagreements.jsonl")

    const disagreements = [
        ...feedbackAwareModel.valEvaluation.disagreements,
        ...feedbackAwareModel.testEvaluation.disagreements,
    ]
    const feedbackComparison = buildFeedbackComparison(staticModel, feedbackAwareModel)

    const report = {
        ok: true,
        datasetVersion: datasetManifest.datasetVersion,
        snapshotId,
        modelMode: feedbackAwareModel.mode,
        datasetRoot,
        evaluationRoot,
        feedbackInputs: {
            featureInputs: [
                "featureAvailability.hasInputDirectiveContext",
                "lineage.inputDirectiveKinds",
                "lineage.inputDirectiveSectionIds",
                "lineage.retryLocalization",
                "lineage.retriedFromAttempt",
            ],
            pairWeightInputs: [
                "reviewSignals.approvalStatus",
                "reviewSignals.appealScore",
                "reviewSignals.selectedAttemptWasRetry",
            ],
        },
        calibratedTemperature: feedbackAwareModel.calibratedTemperature,
        calibration: {
            valBrier: feedbackAwareModel.calibration.brier,
            testBins: buildCalibrationBins(feedbackAwareModel.testEvaluation.groupResults, feedbackAwareModel.calibratedTemperature),
        },
        training: feedbackAwareModel.training,
        featureCount: feedbackAwareModel.featureNames.length,
        splitMetrics: {
            train: feedbackAwareModel.trainEvaluation.metrics,
            val: feedbackAwareModel.valEvaluation.metrics,
            test: feedbackAwareModel.testEvaluation.metrics,
        },
        disagreementSummary: {
            count: disagreements.length,
            highConfidenceCount: disagreements.filter((entry) => entry.highConfidence).length,
        },
        modelSummary: feedbackAwareModel.modelSummary,
        feedbackFeatureSummary: feedbackAwareModel.feedbackFeatureSummary,
        baselineStatic: {
            modelMode: staticModel.mode,
            calibratedTemperature: staticModel.calibratedTemperature,
            calibration: {
                valBrier: staticModel.calibration.brier,
                testBins: buildCalibrationBins(staticModel.testEvaluation.groupResults, staticModel.calibratedTemperature),
            },
            training: staticModel.training,
            featureCount: staticModel.featureNames.length,
            splitMetrics: {
                train: staticModel.trainEvaluation.metrics,
                val: staticModel.valEvaluation.metrics,
                test: staticModel.testEvaluation.metrics,
            },
            modelSummary: staticModel.modelSummary,
            feedbackFeatureSummary: staticModel.feedbackFeatureSummary,
        },
        feedbackComparison,
        outputFiles: {
            reportPath,
            modelPath,
            disagreementsPath,
        },
    }

    writeJsonFile(reportPath, report)
    writeJsonFile(modelPath, {
        snapshotId,
        mode: feedbackAwareModel.mode,
        featureNames: feedbackAwareModel.featureNames,
        weights: feedbackAwareModel.featureNames.map((feature, index) => ({ feature, weight: round(feedbackAwareModel.weights[index] ?? 0, 8) })),
        training: feedbackAwareModel.training,
        calibratedTemperature: feedbackAwareModel.calibratedTemperature,
        modelSummary: feedbackAwareModel.modelSummary,
        feedbackFeatureSummary: feedbackAwareModel.feedbackFeatureSummary,
    })
    writeJsonlFile(disagreementsPath, disagreements)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

try {
    await run()
} catch (error) {
    fail("Failed to evaluate structure shadow reranker", {
        message: error instanceof Error ? error.message : String(error),
    })
}