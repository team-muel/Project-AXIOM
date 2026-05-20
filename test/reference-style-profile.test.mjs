/**
 * test/reference-style-profile.test.mjs
 *
 * RSP-01..18: referenceStyleProfile 단위 테스트
 *
 * 검증 항목:
 *   RSP-01: 빈 SectionArtifactSummary[] → emptyProfile 반환
 *   RSP-02: 단일 섹션 → phraseCount=1, 정상 밀도 계산
 *   RSP-03: 다중 섹션 → 평균 phrase length 정확히 계산
 *   RSP-04: phraseRegularity — 균등 길이 → 0 (완전 규칙)
 *   RSP-05: climaxPosition — 최고 음이 중간 섹션에 있을 때 ~0.5
 *   RSP-06: leapSmoothness — 단 2도 이동만 → 1.0
 *   RSP-07: leapSmoothness — 도약만 → 낮은 값
 *   RSP-08: bassPresenceRatio — MIDI<60 음이 절반일 때 ~0.5
 *   RSP-09: extractStyleProfileFromAbc — 기본 ABC 문자열 파싱
 *   RSP-10: extractStyleProfileFromAbc — 빈 문자열 → emptyProfile 반환
 *   RSP-11: extractStyleProfileFromAbc — 음계 스케일 → leapSmoothness 높음
 *   RSP-12: extractStyleProfileFromAbc — 옥타브 도약 → leapSmoothness 낮음
 *   RSP-13: computeCorpusProfile — 2개 이상 profile → mean/stddev 계산
 *   RSP-14: computeCorpusProfile — 1개 profile → stddev=0 방지 (epsilon)
 *   RSP-15: computeReferenceDistanceScore — 코퍼스 중심에 가까운 후보 → score 낮음
 *   RSP-16: computeReferenceDistanceScore — 코퍼스와 매우 다른 후보 → score 높음 (too_far)
 *   RSP-17: computeReferenceDistanceScore — 빈 corpus → 0.5 반환
 *   RSP-18: parseAbcToNotes — 임시표(accidentals), 옥타브 모디파이어 처리
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

const {
    extractStyleProfileFromSections,
    extractStyleProfileFromAbc,
    parseAbcToNotes,
    computeCorpusProfile,
    computeReferenceDistanceScore,
} = await import("../dist/core/analyze/referenceStyleProfile.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Builds a minimal SectionArtifactSummary-compatible object.
 * pitches: MIDI pitch values for melody events
 * accompaniment: optional MIDI pitches for accompaniment events
 */
function makeSection({
    sectionId = "s1",
    role = "theme_a",
    measureCount = 4,
    pitches = [],
    noteHistory = undefined,
    accompanimentPitches = [],
    melodyPitchMax = undefined,
} = {}) {
    const history = noteHistory ?? pitches;
    return {
        sectionId,
        role,
        measureCount,
        noteHistory: history,
        melodyEvents: pitches.map((p) => ({ type: "note", pitch: p, quarterLength: 1, velocity: 80 })),
        accompanimentEvents: accompanimentPitches.map((p) => ({
            type: "note",
            pitch: p,
            quarterLength: 1,
            velocity: 60,
        })),
        melodyPitchMax,
        melodyPitchMin: pitches.length > 0 ? Math.min(...pitches) : undefined,
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RSP-01: empty sections → emptyProfile", () => {
    it("returns zero profile for empty array", () => {
        const p = extractStyleProfileFromSections([]);
        assert.strictEqual(p.totalMeasures, 0);
        assert.strictEqual(p.totalNotes, 0);
        assert.strictEqual(p.climaxPosition, 0.5, "climax defaults to 0.5");
    });
});

describe("RSP-02: single section → basic stats", () => {
    it("computes density from single section", () => {
        const section = makeSection({
            measureCount: 4,
            pitches: [60, 62, 64, 65, 67, 69, 71, 72],
        });
        const p = extractStyleProfileFromSections([section]);
        assert.strictEqual(p.totalMeasures, 4);
        assert.strictEqual(p.totalNotes, 8, "8 melody notes");
        assert.ok(p.meanNoteDensityPerMeasure > 0, "density > 0");
        assert.strictEqual(p.meanPhraseLengthMeasures, 4, "1 section of 4 measures");
    });
});

describe("RSP-03: multiple sections → mean phrase length", () => {
    it("averages phrase lengths across sections", () => {
        const sections = [
            makeSection({ sectionId: "s1", measureCount: 4, pitches: [60, 64] }),
            makeSection({ sectionId: "s2", measureCount: 8, pitches: [65, 67] }),
            makeSection({ sectionId: "s3", measureCount: 4, pitches: [69, 71] }),
        ];
        const p = extractStyleProfileFromSections(sections);
        // mean = (4+8+4)/3 ≈ 5.33
        assert.ok(Math.abs(p.meanPhraseLengthMeasures - 16 / 3) < 0.01, `got ${p.meanPhraseLengthMeasures}`);
        assert.strictEqual(p.totalMeasures, 16);
    });
});

describe("RSP-04: phraseRegularity — uniform phrase lengths → near 0", () => {
    it("returns phraseRegularity ≈ 0 for equal-length sections", () => {
        const sections = [
            makeSection({ sectionId: "s1", measureCount: 4, pitches: [60] }),
            makeSection({ sectionId: "s2", measureCount: 4, pitches: [62] }),
            makeSection({ sectionId: "s3", measureCount: 4, pitches: [64] }),
        ];
        const p = extractStyleProfileFromSections(sections);
        assert.ok(p.phraseRegularity < 0.01, `phraseRegularity should be ~0, got ${p.phraseRegularity}`);
    });
});

describe("RSP-05: climaxPosition — highest section is the middle one", () => {
    it("climaxPosition ≈ 0.5 when climax is in middle section", () => {
        const sections = [
            makeSection({ sectionId: "s1", measureCount: 4, pitches: [60, 62], melodyPitchMax: 62 }),
            makeSection({ sectionId: "s2", measureCount: 4, pitches: [70, 72], melodyPitchMax: 72 }),
            makeSection({ sectionId: "s3", measureCount: 4, pitches: [60, 65], melodyPitchMax: 65 }),
        ];
        const p = extractStyleProfileFromSections(sections);
        // Climax in section 1 (0-indexed), measures 0-3. Center = measure 2/12 ≈ 0.5
        assert.ok(p.climaxPosition > 0.3 && p.climaxPosition < 0.7, `climaxPosition=${p.climaxPosition}`);
    });
});

describe("RSP-06: leapSmoothness — stepwise motion only → 1.0", () => {
    it("all intervals ≤ 2 semitones → leapSmoothness = 1.0", () => {
        // C D E F G A B c — all stepwise
        const pitches = [60, 62, 64, 65, 67, 69, 71, 72];
        const section = makeSection({ pitches, measureCount: 4 });
        const p = extractStyleProfileFromSections([section]);
        assert.strictEqual(p.leapSmoothness, 1.0, `got ${p.leapSmoothness}`);
    });
});

describe("RSP-07: leapSmoothness — large leaps only → low value", () => {
    it("only octave leaps → leapSmoothness = 0", () => {
        // All 12-semitone intervals
        const pitches = [60, 72, 60, 72, 60];
        const section = makeSection({ pitches, measureCount: 4 });
        const p = extractStyleProfileFromSections([section]);
        assert.strictEqual(p.leapSmoothness, 0, `got ${p.leapSmoothness}`);
    });
});

describe("RSP-08: bassPresenceRatio — half notes below MIDI 60", () => {
    it("returns ~0.5 when half of notes are bass", () => {
        const melodyPitches = [65, 67, 69, 71]; // all above 60
        const bassPitches = [48, 50, 52, 53]; // all below 60
        const section = makeSection({
            pitches: melodyPitches,
            accompanimentPitches: bassPitches,
            measureCount: 4,
        });
        const p = extractStyleProfileFromSections([section]);
        // 4 melody + 4 bass = 8 total; 4 bass below 60 → 0.5
        assert.ok(Math.abs(p.bassPresenceRatio - 0.5) < 0.01, `got ${p.bassPresenceRatio}`);
    });
});

describe("RSP-09: extractStyleProfileFromAbc — parses basic ABC", () => {
    it("extracts profile from a minimal ABC piece", () => {
        const abc = [
            "X:1",
            "T:Test",
            "M:4/4",
            "L:1/8",
            "K:C",
            "C2 D2 E2 F2 | G2 A2 B2 c2 | d2 e2 f2 g2 | a2 b2 c'2 z2 |",
        ].join("\n");
        const p = extractStyleProfileFromAbc(abc);
        assert.ok(p.totalNotes > 0, "should have notes");
        assert.ok(p.totalMeasures >= 4, `expected ≥4 measures, got ${p.totalMeasures}`);
        assert.ok(p.meanPitchMidi > 60, "ascending scale → mean above C4");
        assert.ok(p.meanPitchMidi < 90, `mean pitch should be < 90, got ${p.meanPitchMidi}`);
    });
});

describe("RSP-10: extractStyleProfileFromAbc — empty string → emptyProfile", () => {
    it("returns zero totals for empty ABC", () => {
        const p = extractStyleProfileFromAbc("");
        assert.strictEqual(p.totalNotes, 0, "no notes");
        assert.strictEqual(p.climaxPosition, 0.5, "climax defaults to 0.5");
    });
});

describe("RSP-11: extractStyleProfileFromAbc — ascending scale → high leapSmoothness", () => {
    it("C major scale → leapSmoothness close to 1.0", () => {
        const abc = "X:1\nM:4/4\nL:1/4\nK:C\nC D E F | G A B c |\n";
        const p = extractStyleProfileFromAbc(abc);
        // All intervals are 2 semitones or 1 semitone (E–F, B–c), all ≤ 2
        assert.ok(p.leapSmoothness >= 0.9, `expected ≥0.9, got ${p.leapSmoothness}`);
    });
});

describe("RSP-12: extractStyleProfileFromAbc — octave leaps → low leapSmoothness", () => {
    it("C,c,C,c... pattern → leapSmoothness = 0", () => {
        // All 12-semitone jumps between C3 and c (C4)
        const abc = "X:1\nM:4/4\nL:1/4\nK:C\nC c C c | C c C c |\n";
        const p = extractStyleProfileFromAbc(abc);
        assert.ok(p.leapSmoothness === 0, `expected 0, got ${p.leapSmoothness}`);
    });
});

describe("RSP-13: computeCorpusProfile — mean/stddev from 2+ profiles", () => {
    it("computes correct mean for two profiles", () => {
        const p1 = {
            meanPhraseLengthMeasures: 4, phraseRegularity: 0.1, climaxPosition: 0.6,
            pitchRangeSemitones: 14, meanPitchMidi: 65, leapSmoothness: 0.7,
            meanNoteDensityPerMeasure: 8, bassPresenceRatio: 0.3, harmonicRhythmProxy: 4,
            totalMeasures: 32, totalNotes: 256,
        };
        const p2 = {
            meanPhraseLengthMeasures: 6, phraseRegularity: 0.3, climaxPosition: 0.7,
            pitchRangeSemitones: 18, meanPitchMidi: 67, leapSmoothness: 0.6,
            meanNoteDensityPerMeasure: 10, bassPresenceRatio: 0.4, harmonicRhythmProxy: 5,
            totalMeasures: 48, totalNotes: 480,
        };
        const corpus = computeCorpusProfile([p1, p2]);
        assert.strictEqual(corpus.n, 2);
        assert.ok(Math.abs(corpus.mean.meanPhraseLengthMeasures - 5) < 0.01, "mean=5");
        assert.ok(Math.abs(corpus.mean.meanPitchMidi - 66) < 0.01, "mean midi=66");
        assert.ok(corpus.stddev.meanPhraseLengthMeasures > 0, "stddev > 0");
    });
});

describe("RSP-14: computeCorpusProfile — single profile → stddev not zero", () => {
    it("epsilon guards against division by zero", () => {
        const p1 = {
            meanPhraseLengthMeasures: 4, phraseRegularity: 0.1, climaxPosition: 0.6,
            pitchRangeSemitones: 14, meanPitchMidi: 65, leapSmoothness: 0.7,
            meanNoteDensityPerMeasure: 8, bassPresenceRatio: 0.3, harmonicRhythmProxy: 4,
            totalMeasures: 32, totalNotes: 256,
        };
        const corpus = computeCorpusProfile([p1]);
        // stddev of a single value = 0, but our implementation floors it to 1e-6
        assert.ok(corpus.stddev.meanPhraseLengthMeasures >= 1e-7, "stddev should not be pure zero");
    });
});

describe("RSP-15: computeReferenceDistanceScore — candidate near corpus center → low score", () => {
    it("candidate identical to corpus mean → score ≈ 0", () => {
        const profile = {
            meanPhraseLengthMeasures: 4, phraseRegularity: 0.15, climaxPosition: 0.618,
            pitchRangeSemitones: 16, meanPitchMidi: 67, leapSmoothness: 0.68,
            meanNoteDensityPerMeasure: 9, bassPresenceRatio: 0.33, harmonicRhythmProxy: 4.5,
            totalMeasures: 40, totalNotes: 360,
        };
        // Corpus of 3 very similar profiles → center is approximately profile
        const corpus = computeCorpusProfile([profile, profile, profile]);
        const result = computeReferenceDistanceScore(profile, corpus);
        assert.ok(result.score < 0.15, `score should be low, got ${result.score}`);
        assert.ok(result.copyRisk === true || result.classification === "too_close" || result.score < 0.15,
            "near-center candidate should be in_range or too_close");
    });
});

describe("RSP-16: computeReferenceDistanceScore — very different candidate → too_far", () => {
    it("wildly atypical candidate → score > 0.75", () => {
        // Classical corpus: typical phrase 4-8 measures, mid-range pitch
        const classicalProfiles = Array.from({ length: 5 }, () => ({
            meanPhraseLengthMeasures: 4, phraseRegularity: 0.15, climaxPosition: 0.618,
            pitchRangeSemitones: 16, meanPitchMidi: 67, leapSmoothness: 0.68,
            meanNoteDensityPerMeasure: 9, bassPresenceRatio: 0.33, harmonicRhythmProxy: 4.5,
            totalMeasures: 32, totalNotes: 288,
        }));
        const corpus = computeCorpusProfile(classicalProfiles);

        // Atypical: very long phrases (30 measures), extreme low pitch, almost no bass, very low density
        const atypical = {
            meanPhraseLengthMeasures: 60, phraseRegularity: 2.5, climaxPosition: 0.05,
            pitchRangeSemitones: 1, meanPitchMidi: 30, leapSmoothness: 0.05,
            meanNoteDensityPerMeasure: 0.3, bassPresenceRatio: 0.99, harmonicRhythmProxy: 0.5,
            totalMeasures: 60, totalNotes: 18,
        };
        const result = computeReferenceDistanceScore(atypical, corpus);
        assert.ok(result.score > 0.75, `expected > 0.75, got ${result.score}`);
        assert.strictEqual(result.classification, "too_far");
        assert.strictEqual(result.idiomDrift, true);
    });
});

describe("RSP-17: computeReferenceDistanceScore — empty corpus → 0.5", () => {
    it("returns neutral score when corpus is empty", () => {
        const corpus = computeCorpusProfile([]);
        const profile = {
            meanPhraseLengthMeasures: 4, phraseRegularity: 0.15, climaxPosition: 0.618,
            pitchRangeSemitones: 16, meanPitchMidi: 67, leapSmoothness: 0.68,
            meanNoteDensityPerMeasure: 9, bassPresenceRatio: 0.33, harmonicRhythmProxy: 4.5,
            totalMeasures: 32, totalNotes: 288,
        };
        const result = computeReferenceDistanceScore(profile, corpus);
        assert.strictEqual(result.score, 0.5);
        assert.strictEqual(result.classification, "in_range");
        assert.strictEqual(result.copyRisk, false);
        assert.strictEqual(result.idiomDrift, false);
    });
});

describe("RSP-18: parseAbcToNotes — accidentals and octave modifiers", () => {
    it("^C = C# = MIDI 49, c' = C5 = MIDI 72", () => {
        const abc = "X:1\nM:4/4\nL:1/4\nK:C\n^C c' z z |\n";
        const notes = parseAbcToNotes(abc);
        const pitchNotes = notes.filter((n) => n.pitch >= 0);
        assert.ok(pitchNotes.length >= 2, `expected ≥2 pitch notes, got ${pitchNotes.length}`);
        const cSharp = pitchNotes[0];
        const c5 = pitchNotes[1];
        // ^C in bass octave (ABC uppercase C = MIDI 48), sharp → 49
        assert.strictEqual(cSharp?.pitch, 49, `^C should be MIDI 49, got ${cSharp?.pitch}`);
        // c' = c (MIDI 60) + octave up (12) = 72
        assert.strictEqual(c5?.pitch, 72, `c' should be MIDI 72, got ${c5?.pitch}`);
    });
});
