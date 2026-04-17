import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { AutonomyControlState, AutonomyLedgerEntry, AutonomyPreferences } from "../autonomy/types.js";
import type { JobManifest } from "../pipeline/types.js";

interface LoadManifestOptions {
    hydrateSectionArtifacts?: boolean;
    hydrateExpressionPlan?: boolean;
}

function manifestPath(songId: string): string {
    return path.join(config.outputDir, songId, "manifest.json");
}

export function sectionArtifactsCachePath(songId: string): string {
    return path.join(config.outputDir, songId, "section-artifacts.json");
}

export function expressionPlanCachePath(songId: string): string {
    return path.join(config.outputDir, songId, "expression-plan.json");
}

function systemDir(): string {
    return path.join(config.outputDir, "_system");
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadJsonFile<T>(filePath: string, fallback: T): T {
    if (!fs.existsSync(filePath)) {
        return fallback;
    }

    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch {
        return fallback;
    }
}

function saveJsonFile(filePath: string, value: unknown): void {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function deleteFileIfExists(filePath: string): void {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function cloneManifest<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

const DEFAULT_HUMAN_FEEDBACK_SUMMARY = {
    approvedCount: 0,
    rejectedCount: 0,
    scoredFeedbackCount: 0,
    positiveDimensions: [],
    negativeDimensions: [],
    rejectionReasons: [],
    comparisonReferences: [],
};

const DEFAULT_PREFERENCES: AutonomyPreferences = {
    updatedAt: new Date(0).toISOString(),
    reviewedSongs: 0,
    preferredForms: [],
    preferredKeys: [],
    recentWeaknesses: [],
    recentPromptHashes: [],
    recentPlanSignatures: [],
    successPatterns: [],
    skillGaps: [],
    styleTendency: {},
    successfulMotifReturns: [],
    successfulTensionArcs: [],
    successfulRegisterCenters: [],
    successfulCadenceApproaches: [],
    successfulBassMotionProfiles: [],
    successfulSectionStyles: [],
    successfulPhraseFunctions: [],
    successfulTexturePlans: [],
    successfulHarmonicBehaviors: [],
    humanFeedbackSummary: { ...DEFAULT_HUMAN_FEEDBACK_SUMMARY },
    lastReflection: "",
};

const DEFAULT_CONTROL_STATE: AutonomyControlState = {
    paused: false,
    updatedAt: new Date(0).toISOString(),
};

function controlStatePath(): string {
    return path.join(systemDir(), "state.json");
}

export function saveManifest(manifest: JobManifest): void {
    const dir = path.join(config.outputDir, manifest.songId);
    ensureDir(dir);
    const manifestForDisk = cloneManifest(manifest);
    const cachedSectionArtifacts = manifestForDisk.sectionArtifacts?.length
        ? manifestForDisk.sectionArtifacts.map((entry) => ({ ...entry }))
        : [];
    const cachedExpressionPlan = manifestForDisk.expressionPlan
        ? cloneManifest(manifestForDisk.expressionPlan)
        : undefined;

    if (cachedSectionArtifacts.length > 0) {
        saveJsonFile(sectionArtifactsCachePath(manifest.songId), cachedSectionArtifacts);
    } else {
        deleteFileIfExists(sectionArtifactsCachePath(manifest.songId));
    }

    if (cachedExpressionPlan) {
        saveJsonFile(expressionPlanCachePath(manifest.songId), cachedExpressionPlan);
    } else {
        deleteFileIfExists(expressionPlanCachePath(manifest.songId));
    }

    delete manifestForDisk.sectionArtifacts;
    delete manifestForDisk.expressionPlan;
    fs.writeFileSync(manifestPath(manifest.songId), JSON.stringify(manifestForDisk, null, 2), "utf-8");
}

export function loadManifest(songId: string, options?: LoadManifestOptions): JobManifest | null {
    const p = manifestPath(songId);
    if (!fs.existsSync(p)) return null;

    const manifest = JSON.parse(fs.readFileSync(p, "utf-8")) as JobManifest;
    const hydrateSectionArtifacts = options?.hydrateSectionArtifacts ?? true;
    const hydrateExpressionPlan = options?.hydrateExpressionPlan ?? true;

    if (!hydrateSectionArtifacts) {
        delete manifest.sectionArtifacts;
    }

    if (hydrateSectionArtifacts) {
        const cachedSectionArtifacts = loadJsonFile(
            sectionArtifactsCachePath(songId),
            [] as NonNullable<JobManifest["sectionArtifacts"]>,
        );

        if (cachedSectionArtifacts.length > 0) {
            manifest.sectionArtifacts = cachedSectionArtifacts;
        }
    }

    if (!hydrateExpressionPlan) {
        delete manifest.expressionPlan;
        return manifest;
    }

    const cachedExpressionPlan = loadJsonFile(
        expressionPlanCachePath(songId),
        null as JobManifest["expressionPlan"] | null,
    );

    if (cachedExpressionPlan) {
        manifest.expressionPlan = cachedExpressionPlan;
    }

    return manifest;
}

export function listStoredManifests(limit?: number, options?: LoadManifestOptions): JobManifest[] {
    if (!fs.existsSync(config.outputDir)) return [];

    const manifests = fs
        .readdirSync(config.outputDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "_system")
        .map((entry) => loadManifest(entry.name, {
            hydrateSectionArtifacts: options?.hydrateSectionArtifacts ?? false,
            hydrateExpressionPlan: options?.hydrateExpressionPlan ?? false,
        }))
        .filter((manifest): manifest is JobManifest => manifest !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

    if (typeof limit === "number") {
        return manifests.slice(0, limit);
    }

    return manifests;
}

export function loadAutonomyPreferences(): AutonomyPreferences {
    const filePath = path.join(systemDir(), "preferences.json");
    const stored = loadJsonFile(filePath, DEFAULT_PREFERENCES);
    const preferences: AutonomyPreferences = {
        ...DEFAULT_PREFERENCES,
        ...stored,
        preferredForms: stored.preferredForms ?? [],
        preferredKeys: stored.preferredKeys ?? [],
        recentWeaknesses: stored.recentWeaknesses ?? [],
        recentPromptHashes: stored.recentPromptHashes ?? [],
        recentPlanSignatures: stored.recentPlanSignatures ?? [],
        successPatterns: stored.successPatterns ?? [],
        skillGaps: stored.skillGaps ?? [],
        styleTendency: stored.styleTendency ?? {},
        successfulMotifReturns: stored.successfulMotifReturns ?? [],
        successfulTensionArcs: stored.successfulTensionArcs ?? [],
        successfulRegisterCenters: stored.successfulRegisterCenters ?? [],
        successfulCadenceApproaches: stored.successfulCadenceApproaches ?? [],
        successfulBassMotionProfiles: stored.successfulBassMotionProfiles ?? [],
        successfulSectionStyles: stored.successfulSectionStyles ?? [],
        successfulPhraseFunctions: stored.successfulPhraseFunctions ?? [],
        successfulTexturePlans: stored.successfulTexturePlans ?? [],
        successfulHarmonicBehaviors: stored.successfulHarmonicBehaviors ?? [],
        humanFeedbackSummary: {
            ...DEFAULT_HUMAN_FEEDBACK_SUMMARY,
            ...(stored.humanFeedbackSummary ?? {}),
            positiveDimensions: stored.humanFeedbackSummary?.positiveDimensions ?? [],
            negativeDimensions: stored.humanFeedbackSummary?.negativeDimensions ?? [],
            rejectionReasons: stored.humanFeedbackSummary?.rejectionReasons ?? [],
            comparisonReferences: stored.humanFeedbackSummary?.comparisonReferences ?? [],
        },
        lastReflection: stored.lastReflection ?? "",
    };
    if (!fs.existsSync(filePath)) {
        saveJsonFile(filePath, preferences);
    }
    return preferences;
}

export function saveAutonomyPreferences(preferences: AutonomyPreferences): void {
    saveJsonFile(path.join(systemDir(), "preferences.json"), preferences);
}

export function loadAutonomyRunLedger(dayKey: string): AutonomyLedgerEntry[] {
    return loadJsonFile(path.join(systemDir(), "runs", `${dayKey}.json`), [] as AutonomyLedgerEntry[]);
}

export function saveAutonomyRunLedger(dayKey: string, entries: AutonomyLedgerEntry[]): void {
    saveJsonFile(path.join(systemDir(), "runs", `${dayKey}.json`), entries);
}

export function appendAutonomyRunLedger(dayKey: string, entry: AutonomyLedgerEntry): void {
    const entries = loadAutonomyRunLedger(dayKey);
    entries.push(entry);
    saveAutonomyRunLedger(dayKey, entries);
}

export function loadAutonomyControlState(): AutonomyControlState {
    const state = loadJsonFile(controlStatePath(), DEFAULT_CONTROL_STATE);
    if (!fs.existsSync(controlStatePath())) {
        saveJsonFile(controlStatePath(), state);
    }
    return state;
}

export function saveAutonomyControlState(state: AutonomyControlState): void {
    saveJsonFile(controlStatePath(), state);
}
