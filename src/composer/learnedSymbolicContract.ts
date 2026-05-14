import type { SectionTransformSummary } from "../pipeline/types.js";

export interface LearnedSymbolicProposalEvent {
    kind: "note" | "chord" | "rest";
    quarterLength: number;
    midi?: number;
    midiPitches?: number[];
    velocity?: number;
    role?: string;
}

export interface LearnedSymbolicProposalSection {
    sectionId: string;
    role: string;
    measureCount: number;
    tonalCenter?: string;
    phraseFunction?: string;
    leadEvents: LearnedSymbolicProposalEvent[];
    supportEvents: LearnedSymbolicProposalEvent[];
    noteHistory: number[];
    transform?: SectionTransformSummary;
}

export interface LearnedSymbolicProposalResponse {
    ok: boolean;
    proposalMidiPath?: string;
    proposalSummary?: {
        measureCount?: number;
        noteCount?: number;
        partCount?: number;
        partInstrumentNames?: string[];
        key?: string;
        tempo?: number;
        form?: string;
    };
    proposalMetadata?: {
        lane?: string;
        provider?: string;
        model?: string;
        generationMode?: string;
        confidence?: number;
        normalizationWarnings?: string[];
    };
    proposalSections?: LearnedSymbolicProposalSection[];
    error?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
    return value === undefined || typeof value === "string";
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new Error(`malformed learned symbolic response: ${label} must be a string array`);
    }
}

function assertNumberArray(value: unknown, label: string): asserts value is number[] {
    if (!Array.isArray(value) || value.some((entry) => !isFiniteNumber(entry))) {
        throw new Error(`malformed learned symbolic response: ${label} must be a numeric array`);
    }
}

function validateProposalEvent(event: unknown, label: string): void {
    const record = asRecord(event);
    if (!record) {
        throw new Error(`malformed learned symbolic response: ${label} must be an object`);
    }

    const kind = record.kind;
    if (kind !== "note" && kind !== "chord" && kind !== "rest") {
        throw new Error(`malformed learned symbolic response: ${label}.kind must be note, chord, or rest`);
    }
    if (!isFiniteNumber(record.quarterLength) || record.quarterLength <= 0) {
        throw new Error(`malformed learned symbolic response: ${label}.quarterLength must be a positive number`);
    }
    if (record.velocity !== undefined && !isFiniteNumber(record.velocity)) {
        throw new Error(`malformed learned symbolic response: ${label}.velocity must be numeric when present`);
    }
    if (!isOptionalString(record.role)) {
        throw new Error(`malformed learned symbolic response: ${label}.role must be a string when present`);
    }

    if (kind === "note" && !isFiniteNumber(record.midi)) {
        throw new Error(`malformed learned symbolic response: ${label}.midi must be numeric for note events`);
    }
    if (kind === "chord") {
        assertNumberArray(record.midiPitches, `${label}.midiPitches`);
    }
}

function validateTransform(transform: unknown, label: string): void {
    const record = asRecord(transform);
    if (!record) {
        throw new Error(`malformed learned symbolic response: ${label} must be an object`);
    }

    if (typeof record.sectionId !== "string" || !record.sectionId.trim()) {
        throw new Error(`malformed learned symbolic response: ${label}.sectionId must be a non-empty string`);
    }
    if (typeof record.role !== "string" || !record.role.trim()) {
        throw new Error(`malformed learned symbolic response: ${label}.role must be a non-empty string`);
    }
    if (typeof record.transformMode !== "string" || !record.transformMode.trim()) {
        throw new Error(`malformed learned symbolic response: ${label}.transformMode must be a non-empty string`);
    }
    if (record.sourceSectionId !== undefined && typeof record.sourceSectionId !== "string") {
        throw new Error(`malformed learned symbolic response: ${label}.sourceSectionId must be a string when present`);
    }
    if (record.generatedNoteCount !== undefined && !isFiniteNumber(record.generatedNoteCount)) {
        throw new Error(`malformed learned symbolic response: ${label}.generatedNoteCount must be numeric when present`);
    }
    if (record.sourceNoteCount !== undefined && !isFiniteNumber(record.sourceNoteCount)) {
        throw new Error(`malformed learned symbolic response: ${label}.sourceNoteCount must be numeric when present`);
    }
}

function validateProposalSection(section: unknown, index: number): void {
    const record = asRecord(section);
    const label = `proposalSections[${index}]`;
    if (!record) {
        throw new Error(`malformed learned symbolic response: ${label} must be an object`);
    }

    if (typeof record.sectionId !== "string" || !record.sectionId.trim()) {
        throw new Error(`malformed learned symbolic response: ${label}.sectionId must be a non-empty string`);
    }
    if (typeof record.role !== "string" || !record.role.trim()) {
        throw new Error(`malformed learned symbolic response: ${label}.role must be a non-empty string`);
    }
    if (!isFiniteNumber(record.measureCount) || record.measureCount <= 0) {
        throw new Error(`malformed learned symbolic response: ${label}.measureCount must be a positive number`);
    }
    if (!isOptionalString(record.tonalCenter)) {
        throw new Error(`malformed learned symbolic response: ${label}.tonalCenter must be a string when present`);
    }
    if (!isOptionalString(record.phraseFunction)) {
        throw new Error(`malformed learned symbolic response: ${label}.phraseFunction must be a string when present`);
    }
    if (!Array.isArray(record.leadEvents)) {
        throw new Error(`malformed learned symbolic response: ${label}.leadEvents must be an array`);
    }
    if (!Array.isArray(record.supportEvents)) {
        throw new Error(`malformed learned symbolic response: ${label}.supportEvents must be an array`);
    }
    assertNumberArray(record.noteHistory, `${label}.noteHistory`);
    record.leadEvents.forEach((event, eventIndex) => validateProposalEvent(event, `${label}.leadEvents[${eventIndex}]`));
    record.supportEvents.forEach((event, eventIndex) => validateProposalEvent(event, `${label}.supportEvents[${eventIndex}]`));
    if (record.transform !== undefined) {
        validateTransform(record.transform, `${label}.transform`);
    }
}

export function validateLearnedSymbolicProposalResponse(
    response: LearnedSymbolicProposalResponse,
): LearnedSymbolicProposalResponse {
    const record = asRecord(response);
    if (!record) {
        throw new Error("malformed learned symbolic response: response must be an object");
    }

    if (typeof record.ok !== "boolean") {
        throw new Error("malformed learned symbolic response: ok must be a boolean");
    }
    if (!record.ok) {
        if (typeof record.error !== "string" || !record.error.trim()) {
            throw new Error("malformed learned symbolic response: ok=false responses must include a non-empty error string");
        }
        return response;
    }

    if (typeof record.proposalMidiPath !== "string" || !record.proposalMidiPath.trim()) {
        throw new Error("malformed learned symbolic response: proposalMidiPath must be a non-empty string for successful responses");
    }

    const summary = record.proposalSummary;
    if (summary !== undefined) {
        const summaryRecord = asRecord(summary);
        if (!summaryRecord) {
            throw new Error("malformed learned symbolic response: proposalSummary must be an object when present");
        }
        for (const key of ["measureCount", "noteCount", "partCount", "tempo"] as const) {
            const value = summaryRecord[key];
            if (value !== undefined && !isFiniteNumber(value)) {
                throw new Error(`malformed learned symbolic response: proposalSummary.${key} must be numeric when present`);
            }
        }
        for (const key of ["key", "form"] as const) {
            const value = summaryRecord[key];
            if (value !== undefined && typeof value !== "string") {
                throw new Error(`malformed learned symbolic response: proposalSummary.${key} must be a string when present`);
            }
        }
        if (summaryRecord.partInstrumentNames !== undefined) {
            assertStringArray(summaryRecord.partInstrumentNames, "proposalSummary.partInstrumentNames");
        }
    }

    const metadata = record.proposalMetadata;
    if (metadata !== undefined) {
        const metadataRecord = asRecord(metadata);
        if (!metadataRecord) {
            throw new Error("malformed learned symbolic response: proposalMetadata must be an object when present");
        }
        for (const key of ["lane", "provider", "model", "generationMode"] as const) {
            const value = metadataRecord[key];
            if (value !== undefined && typeof value !== "string") {
                throw new Error(`malformed learned symbolic response: proposalMetadata.${key} must be a string when present`);
            }
        }
        if (metadataRecord.confidence !== undefined && !isFiniteNumber(metadataRecord.confidence)) {
            throw new Error("malformed learned symbolic response: proposalMetadata.confidence must be numeric when present");
        }
        if (metadataRecord.normalizationWarnings !== undefined) {
            assertStringArray(metadataRecord.normalizationWarnings, "proposalMetadata.normalizationWarnings");
        }
    }

    const sections = record.proposalSections;
    if (sections !== undefined) {
        if (!Array.isArray(sections)) {
            throw new Error("malformed learned symbolic response: proposalSections must be an array when present");
        }
        sections.forEach((section, index) => validateProposalSection(section, index));
    }

    if (record.error !== undefined && typeof record.error !== "string") {
        throw new Error("malformed learned symbolic response: error must be a string when present");
    }

    return response;
}