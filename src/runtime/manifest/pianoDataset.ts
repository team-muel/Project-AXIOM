import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../../config.js";
import type {
    ApprovalStatus,
    ListenerFeedback,
    PianoCraftScoreSummary,
    PianoDataLoopEntry,
    PianoDataLoopEvidence,
    PianoDataLoopInput,
    PianoPlan,
    PianoPlayabilityExample,
    PianoPreferenceExample,
    PianoRevisionDirective,
    PianoRewriteExample,
    PianoSftExample,
    SectionArtifactSummary,
} from "../../core/pipeline/types.js";

// pianoDataset.ts — Piano generation data loop: capture and export
// ─────────────────────────────────────────────────────────────────────────────
//
// Every piano candidate evaluation appends a PianoDataLoopEntry to the rolling
// JSONL log at outputs/_system/piano-data-loop.jsonl.
//
// Four exporters consume that log to produce fine-tuning dataset files:
//
//   piano_sft_dataset.jsonl       — AXIOM control block → approved ABC
//   piano_rewrite_dataset.jsonl   — bad section + issue report → corrected
//   piano_preference_dataset.jsonl — same-prompt chosen/rejected pairs (DPO)
//   piano_playability_dataset.jsonl — passage + playable/unplayable label
//
// Storage contract: outputs/_system/datasets/<name>.jsonl
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Threshold below which pianoPlayabilityScore is labelled "unplayable". */
export const PLAYABILITY_LABEL_THRESHOLD = 0.60;

/** Minimum finalPianoScore difference for a preference pair to be included. */
export const PREFERENCE_SCORE_MARGIN = 0.05;

const PIANO_DATA_LOOP_JSONL_FILENAME = "piano-data-loop.jsonl";
const DATASETS_DIR_NAME = "datasets";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function systemDir(): string {
    return path.join(config.outputDir, "_system");
}

function pianoDataLoopPath(): string {
    return path.join(systemDir(), PIANO_DATA_LOOP_JSONL_FILENAME);
}

function datasetsDir(): string {
    return path.join(systemDir(), DATASETS_DIR_NAME);
}

function datasetPath(name: string): string {
    return path.join(datasetsDir(), `${name}.jsonl`);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
}

function buildEntryId(songId: string, candidateId: string, capturedAt: string): string {
    return createHash("sha1")
        .update(`${songId}:${candidateId}:${capturedAt}`)
        .digest("hex")
        .slice(0, 16);
}

function assembleControlBlock(input: PianoDataLoopInput): string {
    const lines: string[] = [...input.controlLines];
    if (input.pianoGlobalLine) lines.push(input.pianoGlobalLine);
    if (input.pianoSectionLines) {
        const sectionLines = input.pianoSectionLines;
        // Interleave piano_section lines after each matching section line
        // (simple append if no ordering information is available)
        lines.push(...sectionLines);
    }
    return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Build helper: aggregate piano evidence from section artifacts
// ---------------------------------------------------------------------------

/**
 * Aggregates the flat piano* fields from an array of SectionArtifactSummary
 * into a single PianoDataLoopEvidence record.
 *
 * Only sections with at least one piano field populated contribute.
 * Undefined fields in individual sections are skipped; numeric fields are
 * averaged / max-reduced as appropriate.
 */
export function buildPianoDataLoopEvidence(
    sections: SectionArtifactSummary[],
): PianoDataLoopEvidence | undefined {
    const piano = sections.filter((s) =>
        s.pianoPlayabilityScore != null || s.pianoHandSpanMax != null,
    );
    if (piano.length === 0) return undefined;

    function maxOf(field: keyof SectionArtifactSummary): number | undefined {
        const vals = piano.map((s) => s[field] as number | undefined).filter((v) => v != null) as number[];
        return vals.length > 0 ? Math.max(...vals) : undefined;
    }
    function avgOf(field: keyof SectionArtifactSummary): number | undefined {
        const vals = piano.map((s) => s[field] as number | undefined).filter((v) => v != null) as number[];
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
    }
    function sumOf(field: keyof SectionArtifactSummary): number | undefined {
        const vals = piano.map((s) => s[field] as number | undefined).filter((v) => v != null) as number[];
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : undefined;
    }
    function minOf(field: keyof SectionArtifactSummary): number | undefined {
        const vals = piano.map((s) => s[field] as number | undefined).filter((v) => v != null) as number[];
        return vals.length > 0 ? Math.min(...vals) : undefined;
    }

    return {
        handSpanMax: maxOf("pianoHandSpanMax"),
        handSpanAverage: avgOf("pianoHandSpanAverage"),
        playabilityScore: avgOf("pianoPlayabilityScore"),
        idiomaticTextureScore: avgOf("pianoIdiomaticTextureScore"),
        rightHandPitchMin: minOf("pianoRightHandPitchMin"),
        rightHandPitchMax: maxOf("pianoRightHandPitchMax"),
        leftHandPitchMin: minOf("pianoLeftHandPitchMin"),
        leftHandPitchMax: maxOf("pianoLeftHandPitchMax"),
        rightHandDensity: avgOf("pianoRightHandDensity"),
        leftHandDensity: avgOf("pianoLeftHandDensity"),
        chordDensity: avgOf("pianoChordDensity"),
        maxSimultaneousNotes: maxOf("pianoMaxSimultaneousNotes"),
        awkwardChordCount: sumOf("pianoAwkwardChordCount"),
        handCrossingCount: sumOf("pianoHandCrossingCount"),
        registerCollisionCount: sumOf("pianoRegisterCollisionCount"),
        repeatedOctaveRate: avgOf("pianoRepeatedOctaveRate"),
        leapMaxRight: maxOf("pianoLeapMaxRight"),
        leapMaxLeft: maxOf("pianoLeapMaxLeft"),
        leapAverageRight: avgOf("pianoLeapAverageRight"),
        leapAverageLeft: avgOf("pianoLeapAverageLeft"),
        pedalChangeCount: sumOf("pianoPedalChangeCount"),
        pedalBlurRisk: avgOf("pianoPedalBlurRisk"),
    };
}

// ---------------------------------------------------------------------------
// savePianoDataLoopEntry
// ---------------------------------------------------------------------------

/**
 * Appends one PianoDataLoopEntry to the rolling JSONL log.
 *
 * Each call is a single atomic line-append; no lock is needed for normal
 * single-process AXIOM operation.
 */
export function savePianoDataLoopEntry(
    entry: Omit<PianoDataLoopEntry, "version" | "entryId">,
): PianoDataLoopEntry {
    const capturedAt = entry.capturedAt ?? new Date().toISOString();
    const full: PianoDataLoopEntry = {
        version: 1,
        entryId: buildEntryId(entry.songId, entry.candidateId, capturedAt),
        ...entry,
        capturedAt,
    };
    ensureDir(systemDir());
    fs.appendFileSync(pianoDataLoopPath(), `${JSON.stringify(full)}\n`, "utf8");
    return full;
}

// ---------------------------------------------------------------------------
// loadPianoDataLoopEntries
// ---------------------------------------------------------------------------

/**
 * Reads all entries from the JSONL log.
 * Returns an empty array when the file does not yet exist.
 */
export function loadPianoDataLoopEntries(): PianoDataLoopEntry[] {
    const filePath = pianoDataLoopPath();
    if (!fs.existsSync(filePath)) return [];
    return fs
        .readFileSync(filePath, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as PianoDataLoopEntry);
}

// ---------------------------------------------------------------------------
// Export: piano_sft_dataset
// ---------------------------------------------------------------------------

/**
 * Exports SFT (supervised fine-tuning) examples from approved piano
 * candidates.
 *
 * Each example pairs the assembled AXIOM control block with the full
 * approved ABC text.  Only entries where approvalStatus = "approved" and
 * abcText is non-empty are included.
 */
export function exportPianoSftDataset(
    outputPath?: string,
    entries?: PianoDataLoopEntry[],
): PianoSftExample[] {
    const all = entries ?? loadPianoDataLoopEntries();
    const examples: PianoSftExample[] = all
        .filter(
            (e): e is PianoDataLoopEntry & { abcText: string; approvalStatus: "approved" } =>
                e.approvalStatus === "approved" &&
                typeof e.abcText === "string" &&
                e.abcText.trim().length > 0,
        )
        .map((e) => ({
            kind: "piano_sft" as const,
            entryId: e.entryId,
            songId: e.songId,
            candidateId: e.candidateId,
            capturedAt: e.capturedAt,
            controlBlock: assembleControlBlock(e.input),
            conditioningText: e.input.conditioningText,
            approvedAbc: e.abcText,
            pianoPlan: e.pianoPlan,
            listenerFeedback: e.listenerFeedback,
            pianoCraftScore: e.pianoCraftScore,
        }));

    const dest = outputPath ?? datasetPath("piano_sft_dataset");
    writeDatasetJsonl(dest, examples);
    return examples;
}

// ---------------------------------------------------------------------------
// Export: piano_rewrite_dataset
// ---------------------------------------------------------------------------

/**
 * Exports rewrite training examples from entries where a localized piano
 * rewrite was performed (rewriteApplied = true, parentCandidateId present).
 *
 * Each example pairs the pre-rewrite ABC (from parent entry) with the
 * post-rewrite ABC along with the directives that motivated the change.
 */
export function exportPianoRewriteDataset(
    outputPath?: string,
    entries?: PianoDataLoopEntry[],
): PianoRewriteExample[] {
    const all = entries ?? loadPianoDataLoopEntries();
    const byId = new Map<string, PianoDataLoopEntry>(all.map((e) => [e.candidateId, e]));

    const examples: PianoRewriteExample[] = [];
    for (const e of all) {
        if (!e.rewriteApplied) continue;
        if (!e.parentCandidateId) continue;
        if (!e.abcText) continue;
        if (!e.rewriteDirectives || e.rewriteDirectives.length === 0) continue;

        const parent = byId.get(e.parentCandidateId);
        const beforeAbc = parent?.abcText;
        const beforeEvidence = parent?.pianoEvidence;
        const beforeScore = parent?.pianoCraftScore?.finalPianoScore;
        const afterScore = e.pianoCraftScore?.finalPianoScore;

        const improved =
            beforeScore != null && afterScore != null ? afterScore > beforeScore : undefined;

        const example: PianoRewriteExample = {
            kind: "piano_rewrite",
            entryId: e.entryId,
            songId: e.songId,
            candidateId: e.candidateId,
            parentCandidateId: e.parentCandidateId,
            capturedAt: e.capturedAt,
            rewrittenSectionIds: e.rewrittenSectionIds ?? [],
            reason: e.rewriteDirectives.map((d) => d.reason).join("; "),
            directives: e.rewriteDirectives,
            pianoRewriteBlock: e.input.pianoRewriteBlock,
            beforeAbc,
            afterAbc: e.abcText,
            beforeEvidence,
            afterEvidence: e.pianoEvidence,
            improved,
            beforePianoScore: beforeScore,
            afterPianoScore: afterScore,
        };
        examples.push(example);
    }

    const dest = outputPath ?? datasetPath("piano_rewrite_dataset");
    writeDatasetJsonl(dest, examples);
    return examples;
}

// ---------------------------------------------------------------------------
// Export: piano_preference_dataset
// ---------------------------------------------------------------------------

/**
 * Exports DPO-style preference pairs from entries that share the same
 * song + control block hash (i.e. same composition prompt, different candidates).
 *
 * Chosen/rejected selection logic (in order):
 *   1. listener_approved — one approved, other not
 *   2. craft_score_higher — higher finalPianoScore wins (margin >= PREFERENCE_SCORE_MARGIN)
 *   3. playability_gate — higher pianoPlayabilityScore wins when craft scores are equal
 */
export function exportPianoPreferenceDataset(
    outputPath?: string,
    entries?: PianoDataLoopEntry[],
): PianoPreferenceExample[] {
    const all = entries ?? loadPianoDataLoopEntries();

    // Group by songId + control-block hash (same prompt → same group)
    const groups = new Map<string, PianoDataLoopEntry[]>();
    for (const e of all) {
        if (!e.abcText) continue;
        const key = `${e.songId}:${createHash("sha1").update(assembleControlBlock(e.input)).digest("hex").slice(0, 12)}`;
        const group = groups.get(key) ?? [];
        group.push(e);
        groups.set(key, group);
    }

    const examples: PianoPreferenceExample[] = [];

    for (const [, group] of groups) {
        if (group.length < 2) continue;

        // Pick best and worst using the selection logic
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i]!;
                const b = group[j]!;

                let chosen: PianoDataLoopEntry | undefined;
                let rejected: PianoDataLoopEntry | undefined;
                let choiceReason: PianoPreferenceExample["choiceReason"] | undefined;

                const aApproved = a.approvalStatus === "approved";
                const bApproved = b.approvalStatus === "approved";

                if (aApproved !== bApproved) {
                    chosen = aApproved ? a : b;
                    rejected = aApproved ? b : a;
                    choiceReason = "listener_approved";
                } else {
                    const aScore = a.pianoCraftScore?.finalPianoScore;
                    const bScore = b.pianoCraftScore?.finalPianoScore;
                    if (aScore != null && bScore != null) {
                        const diff = aScore - bScore;
                        if (Math.abs(diff) >= PREFERENCE_SCORE_MARGIN) {
                            chosen = diff > 0 ? a : b;
                            rejected = diff > 0 ? b : a;
                            choiceReason = "craft_score_higher";
                        }
                    }

                    if (!chosen) {
                        const aPlay = a.pianoEvidence?.playabilityScore;
                        const bPlay = b.pianoEvidence?.playabilityScore;
                        if (aPlay != null && bPlay != null && Math.abs(aPlay - bPlay) >= 0.10) {
                            chosen = aPlay > bPlay ? a : b;
                            rejected = aPlay > bPlay ? b : a;
                            choiceReason = "playability_gate";
                        }
                    }
                }

                if (!chosen || !rejected || !choiceReason) continue;

                const pairId = createHash("sha1")
                    .update(`${chosen.candidateId}:${rejected.candidateId}`)
                    .digest("hex")
                    .slice(0, 12);

                examples.push({
                    kind: "piano_preference",
                    pairId,
                    songId: chosen.songId,
                    capturedAt: chosen.capturedAt,
                    controlBlock: assembleControlBlock(chosen.input),
                    pianoPlan: chosen.pianoPlan,
                    chosen: {
                        entryId: chosen.entryId,
                        candidateId: chosen.candidateId,
                        abc: chosen.abcText!,
                        pianoCraftScore: chosen.pianoCraftScore,
                        listenerFeedback: chosen.listenerFeedback,
                    },
                    rejected: {
                        entryId: rejected.entryId,
                        candidateId: rejected.candidateId,
                        abc: rejected.abcText!,
                        pianoCraftScore: rejected.pianoCraftScore,
                        listenerFeedback: rejected.listenerFeedback,
                    },
                    choiceReason,
                });
            }
        }
    }

    const dest = outputPath ?? datasetPath("piano_preference_dataset");
    writeDatasetJsonl(dest, examples);
    return examples;
}

// ---------------------------------------------------------------------------
// Export: piano_playability_dataset
// ---------------------------------------------------------------------------

/**
 * Exports playability classification examples from all entries that have
 * pianoEvidence.playabilityScore present.
 *
 * Label: "playable" when playabilityScore >= PLAYABILITY_LABEL_THRESHOLD,
 *        "unplayable" otherwise.
 */
export function exportPianoPlayabilityDataset(
    outputPath?: string,
    entries?: PianoDataLoopEntry[],
): PianoPlayabilityExample[] {
    const all = entries ?? loadPianoDataLoopEntries();
    const examples: PianoPlayabilityExample[] = all
        .filter(
            (e): e is PianoDataLoopEntry & { abcText: string } =>
                typeof e.abcText === "string" &&
                e.abcText.trim().length > 0 &&
                e.pianoEvidence?.playabilityScore != null,
        )
        .map((e) => {
            const score = e.pianoEvidence!.playabilityScore!;
            return {
                kind: "piano_playability" as const,
                entryId: e.entryId,
                songId: e.songId,
                candidateId: e.candidateId,
                capturedAt: e.capturedAt,
                abc: e.abcText,
                playabilityScore: score,
                label: score >= PLAYABILITY_LABEL_THRESHOLD ? ("playable" as const) : ("unplayable" as const),
                evidence: e.pianoEvidence!,
                pianoCraftScore: e.pianoCraftScore,
            };
        });

    const dest = outputPath ?? datasetPath("piano_playability_dataset");
    writeDatasetJsonl(dest, examples);
    return examples;
}

// ---------------------------------------------------------------------------
// exportAllPianoDatasets — convenience wrapper
// ---------------------------------------------------------------------------

export interface PianoDatasetExportSummary {
    sftCount: number;
    rewriteCount: number;
    preferenceCount: number;
    playabilityCount: number;
    totalEntries: number;
    datasetsDir: string;
}

/**
 * Runs all four dataset exporters in sequence and returns a summary.
 */
export function exportAllPianoDatasets(
    overrideOutputDir?: string,
): PianoDatasetExportSummary {
    const entries = loadPianoDataLoopEntries();
    const outDir = overrideOutputDir ?? datasetsDir();

    const sft = exportPianoSftDataset(path.join(outDir, "piano_sft_dataset.jsonl"), entries);
    const rewrite = exportPianoRewriteDataset(path.join(outDir, "piano_rewrite_dataset.jsonl"), entries);
    const preference = exportPianoPreferenceDataset(path.join(outDir, "piano_preference_dataset.jsonl"), entries);
    const playability = exportPianoPlayabilityDataset(path.join(outDir, "piano_playability_dataset.jsonl"), entries);

    return {
        sftCount: sft.length,
        rewriteCount: rewrite.length,
        preferenceCount: preference.length,
        playabilityCount: playability.length,
        totalEntries: entries.length,
        datasetsDir: outDir,
    };
}

// ---------------------------------------------------------------------------
// buildPianoDataLoopEntryFromManifest — convenience builder
// ---------------------------------------------------------------------------

/**
 * Constructs a PianoDataLoopEntry from already-resolved manifest fields.
 *
 * Call this from the orchestrator immediately after a piano candidate is
 * evaluated and scored (before savePianoDataLoopEntry).
 */
export function buildPianoDataLoopEntryFromManifest(opts: {
    songId: string;
    candidateId: string;
    input: PianoDataLoopInput;
    pianoPlan?: PianoPlan;
    abcText?: string;
    hasMidi: boolean;
    pianoEvidence?: PianoDataLoopEvidence;
    pianoCraftScore?: PianoCraftScoreSummary;
    listenerFeedback?: ListenerFeedback;
    approvalStatus?: ApprovalStatus;
    repairApplied?: boolean;
    rewriteApplied?: boolean;
    rewriteDirectives?: PianoRevisionDirective[];
    parentCandidateId?: string;
    rewrittenSectionIds?: string[];
}): Omit<PianoDataLoopEntry, "version" | "entryId"> {
    return {
        songId: opts.songId,
        candidateId: opts.candidateId,
        capturedAt: new Date().toISOString(),
        input: opts.input,
        pianoPlan: opts.pianoPlan,
        abcText: opts.abcText,
        hasMidi: opts.hasMidi,
        pianoEvidence: opts.pianoEvidence,
        pianoCraftScore: opts.pianoCraftScore,
        listenerFeedback: opts.listenerFeedback,
        approvalStatus: opts.approvalStatus,
        repairApplied: opts.repairApplied,
        rewriteApplied: opts.rewriteApplied,
        rewriteDirectives: opts.rewriteDirectives,
        parentCandidateId: opts.parentCandidateId,
        rewrittenSectionIds: opts.rewrittenSectionIds,
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function writeDatasetJsonl(filePath: string, records: unknown[]): void {
    ensureDir(path.dirname(filePath));
    const content = records.map((r) => JSON.stringify(r)).join("\n");
    fs.writeFileSync(filePath, content.length > 0 ? `${content}\n` : "", "utf8");
}
