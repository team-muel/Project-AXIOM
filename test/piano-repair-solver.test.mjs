import test from "node:test";
import assert from "node:assert/strict";
import {
    repairPianoSection,
    repairPianoCandidates,
} from "../dist/pipeline/pianoRepairSolver.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function note(pitch, quarterLength = 1.0, velocity = 80) {
    return { type: "note", pitch, quarterLength, velocity };
}

function chord(pitches, quarterLength = 1.0) {
    return { type: "chord", pitches, quarterLength };
}

function rest(quarterLength = 1.0) {
    return { type: "rest", quarterLength };
}

function section(overrides = {}) {
    return {
        sectionId: "s1",
        role: "theme_a",
        measureCount: 4,
        melodyEvents: [],
        accompanimentEvents: [],
        noteHistory: [],
        ...overrides,
    };
}

// ─── 1. chord_span_revoice ────────────────────────────────────────────────────

test("chord_span_revoice: wide chord (span > 14) drops too-far inner voice", () => {
    // C3-G3-E4-C5 = MIDI 48, 55, 64, 72
    // bass=48, melody=72; inner = [55, 64]
    // 55-48=7 ≤ 14 → kept; 64-48=16 > 14 → dropped
    // Result: [48, 55, 72] — 3 notes instead of 4
    const artifact = section({
        melodyEvents: [chord([48, 55, 64, 72])],
    });
    const result = repairPianoSection(artifact, { maxRHSpan: 14 });
    assert.ok(result.repaired, "should be repaired");
    const ev = result.updatedArtifact.melodyEvents[0];
    const pitches = ev.pitches ?? [ev.pitch];
    // Bass and melody always preserved
    assert.ok(pitches.includes(48), "bass (48) should be kept");
    assert.ok(pitches.includes(72), "melody (72) should be kept");
    // Inner voice too far from bass (64-48=16) should be dropped
    assert.ok(!pitches.includes(64), "inner 64 (16 from bass) should be dropped");
    // Inner voice within range (55-48=7) should be kept
    assert.ok(pitches.includes(55), "inner 55 (7 from bass) should be kept");
    assert.equal(pitches.length, 3, "chord trimmed from 4 to 3 notes");
});

test("chord_span_revoice: comfortable chord (span <= 14) unchanged", () => {
    const artifact = section({ melodyEvents: [chord([60, 64, 67, 72])] }); // span = 12
    const result = repairPianoSection(artifact, { maxRHSpan: 14 });
    const ev = result.updatedArtifact.melodyEvents[0];
    assert.deepEqual(ev.pitches, [60, 64, 67, 72]);
});

test("chord_span_revoice: single note unchanged", () => {
    const artifact = section({ melodyEvents: [note(60)] });
    const result = repairPianoSection(artifact, { enabledRepairs: ["chord_span_revoice"] });
    assert.equal(result.repaired, false);
    assert.equal(result.updatedArtifact.melodyEvents[0].pitch, 60);
});

// ─── 2. register_correction ───────────────────────────────────────────────────

test("register_correction: RH note below floor (48) shifted up one octave", () => {
    // MIDI 36 = C2 — too low for RH
    const artifact = section({ melodyEvents: [note(36)] });
    const result = repairPianoSection(artifact, {
        rhRegisterFloor: 48,
        enabledRepairs: ["register_correction"],
    });
    assert.ok(result.repaired);
    assert.equal(result.updatedArtifact.melodyEvents[0].pitch, 48);
});

test("register_correction: LH note above ceiling (72) shifted down one octave", () => {
    // MIDI 84 = C6 — too high for LH
    const artifact = section({ accompanimentEvents: [note(84)] });
    const result = repairPianoSection(artifact, {
        lhRegisterCeiling: 72,
        enabledRepairs: ["register_correction"],
    });
    assert.ok(result.repaired);
    assert.equal(result.updatedArtifact.accompanimentEvents[0].pitch, 72);
});

test("register_correction: in-range notes unchanged", () => {
    const artifact = section({
        melodyEvents: [note(60), note(72)],
        accompanimentEvents: [note(48), note(36)],
    });
    const result = repairPianoSection(artifact, { enabledRepairs: ["register_correction"] });
    assert.equal(result.repaired, false);
});

test("register_correction: rest events are skipped", () => {
    const artifact = section({ melodyEvents: [rest(1.0)] });
    const result = repairPianoSection(artifact, { enabledRepairs: ["register_correction"] });
    assert.equal(result.repaired, false);
    assert.equal(result.updatedArtifact.melodyEvents[0].type, "rest");
});

// ─── 3. leap_attenuation ──────────────────────────────────────────────────────

test("leap_attenuation: ascending leap > 12 is compressed down", () => {
    // C4 (60) → C6 (84) = +24 semitones → too large
    const artifact = section({ melodyEvents: [note(60), note(84)] });
    const result = repairPianoSection(artifact, {
        maxLeapSemitones: 12,
        enabledRepairs: ["leap_attenuation"],
    });
    assert.ok(result.repaired);
    const secondPitch = result.updatedArtifact.melodyEvents[1].pitch;
    const interval = secondPitch - 60;
    assert.ok(Math.abs(interval) <= 12, `interval ${interval} should be <= 12 after attenuation`);
});

test("leap_attenuation: descending leap > 12 is compressed up", () => {
    // C5 (72) → C3 (48) = -24 semitones
    const artifact = section({ melodyEvents: [note(72), note(48)] });
    const result = repairPianoSection(artifact, {
        maxLeapSemitones: 12,
        enabledRepairs: ["leap_attenuation"],
    });
    assert.ok(result.repaired);
    const secondPitch = result.updatedArtifact.melodyEvents[1].pitch;
    const interval = secondPitch - 72;
    assert.ok(Math.abs(interval) <= 12, `interval ${interval} should be <= 12`);
});

test("leap_attenuation: stepwise motion unchanged", () => {
    // All intervals <= 5 semitones
    const artifact = section({ melodyEvents: [note(60), note(62), note(64), note(65), note(67)] });
    const result = repairPianoSection(artifact, {
        maxLeapSemitones: 12,
        enabledRepairs: ["leap_attenuation"],
    });
    assert.equal(result.repaired, false);
});

test("leap_attenuation: rests do not count as leap partner", () => {
    // C4, rest, C6 — after rest, C6 has no previous pitch for comparison
    const artifact = section({ melodyEvents: [note(60), rest(), note(84)] });
    const result = repairPianoSection(artifact, {
        maxLeapSemitones: 12,
        enabledRepairs: ["leap_attenuation"],
    });
    // The leap across a rest is allowed (rest resets prevPitch)
    assert.equal(result.repaired, false);
});

// ─── 4. bass_reinforcement ────────────────────────────────────────────────────

test("bass_reinforcement: LH all above E3 (52) gets shifted down", () => {
    // LH notes all in C4 (60) range — no bass
    const artifact = section({
        accompanimentEvents: [note(60), note(64), note(67)],
    });
    const result = repairPianoSection(artifact, { enabledRepairs: ["bass_reinforcement"] });
    assert.ok(result.repaired);
    const pitches = result.updatedArtifact.accompanimentEvents.flatMap((ev) =>
        ev.type === "chord" ? ev.pitches : [ev.pitch]
    ).filter(Boolean);
    const minPitch = Math.min(...pitches);
    assert.ok(minPitch <= 52, `min pitch ${minPitch} should be <= 52 after bass reinforcement`);
});

test("bass_reinforcement: LH with bass already present is unchanged", () => {
    // Has a D2 (38) — already in bass territory
    const artifact = section({
        accompanimentEvents: [note(38), note(50), note(55)],
    });
    const result = repairPianoSection(artifact, { enabledRepairs: ["bass_reinforcement"] });
    assert.equal(result.repaired, false);
    assert.equal(result.updatedArtifact.accompanimentEvents[0].pitch, 38);
});

test("bass_reinforcement: empty LH does not crash", () => {
    const artifact = section({ accompanimentEvents: [] });
    const result = repairPianoSection(artifact, { enabledRepairs: ["bass_reinforcement"] });
    assert.equal(result.repaired, false);
});

// ─── 5. voicing_clarity ───────────────────────────────────────────────────────

test("voicing_clarity: LH note above RH floor removed", () => {
    // RH starts at MIDI 60; LH has a note at 65 (above 60) → remove
    const artifact = section({
        melodyEvents: [note(60), note(67)],
        accompanimentEvents: [chord([48, 55, 65])], // 65 is above RH floor 60
    });
    const result = repairPianoSection(artifact, { enabledRepairs: ["voicing_clarity"] });
    assert.ok(result.repaired);
    const lhChord = result.updatedArtifact.accompanimentEvents[0];
    const lhPitches = lhChord.pitches ?? [lhChord.pitch];
    assert.ok(!lhPitches.includes(65), "65 should be removed (above RH floor 60)");
    assert.ok(lhPitches.includes(48), "bass 48 should remain");
    assert.ok(lhPitches.includes(55), "55 should remain (below 60)");
});

test("voicing_clarity: LH notes below RH floor are kept", () => {
    const artifact = section({
        melodyEvents: [note(72)],
        accompanimentEvents: [note(48), note(55)],
    });
    const result = repairPianoSection(artifact, { enabledRepairs: ["voicing_clarity"] });
    assert.equal(result.repaired, false);
});

test("voicing_clarity: does not empty an event (keeps it even if all notes collide)", () => {
    // If removing collision notes would empty the event, leave it
    const artifact = section({
        melodyEvents: [note(48)],
        accompanimentEvents: [chord([48, 50])], // both >= RH floor 48
    });
    const result = repairPianoSection(artifact, { enabledRepairs: ["voicing_clarity"] });
    const lhEv = result.updatedArtifact.accompanimentEvents[0];
    // Event should not be silenced
    const ps = lhEv.pitches ?? [lhEv.pitch];
    assert.ok(ps.length > 0, "event should not be emptied");
});

// ─── 6. pedal_change_increase ─────────────────────────────────────────────────

test("pedal_change_increase: high blur risk increases pianoPedalChangeCount", () => {
    // projection overwrites pianoPedalChangeCount with pedalEventCount (none here → undefined/0),
    // then repair adds additionalPedalChanges on top; final value = 0 + additionalChanges >= 1
    const artifact = section({ pianoPedalBlurRisk: 0.85 });
    const result = repairPianoSection(artifact, {
        pedalBlurThreshold: 0.60,
        enabledRepairs: ["pedal_change_increase"],
    });
    assert.ok(result.repaired);
    assert.ok(
        result.actions.some((a) => a.kind === "pedal_change_increase"),
        "should have a pedal_change_increase action",
    );
    assert.ok(
        (result.updatedArtifact.pianoPedalChangeCount ?? 0) >= 1,
        "pedal change count should be at least 1 after repair",
    );
});

test("pedal_change_increase: blur risk at or below threshold → no repair", () => {
    const artifact = section({ pianoPedalBlurRisk: 0.40 });
    const result = repairPianoSection(artifact, {
        pedalBlurThreshold: 0.60,
        enabledRepairs: ["pedal_change_increase"],
    });
    assert.equal(result.repaired, false);
});

// ─── 7. chord_thinning ────────────────────────────────────────────────────────

test("chord_thinning: 8-note chord reduced to maxSimultaneousNotes", () => {
    // C major chord with octave doublings — 8 notes
    const fat = chord([36, 48, 52, 55, 60, 64, 67, 72]);
    const artifact = section({ melodyEvents: [fat] });
    const result = repairPianoSection(artifact, {
        maxSimultaneousNotes: 4,
        enabledRepairs: ["chord_thinning"],
    });
    assert.ok(result.repaired);
    const ev = result.updatedArtifact.melodyEvents[0];
    const ps = ev.pitches ?? [ev.pitch];
    assert.ok(ps.length <= 4, `chord should have <= 4 notes, got ${ps.length}`);
    assert.ok(ps.includes(36), "bass (36) should be preserved");
    assert.ok(ps.includes(72), "melody (72) should be preserved");
});

test("chord_thinning: chord within limit unchanged", () => {
    const artifact = section({ melodyEvents: [chord([60, 64, 67])] }); // 3 notes
    const result = repairPianoSection(artifact, {
        maxSimultaneousNotes: 6,
        enabledRepairs: ["chord_thinning"],
    });
    assert.equal(result.repaired, false);
    assert.deepEqual(result.updatedArtifact.melodyEvents[0].pitches, [60, 64, 67]);
});

// ─── Integration: repairPianoSection ─────────────────────────────────────────

test("repairPianoSection: idiomatic section generates no repairs", () => {
    const artifact = section({
        melodyEvents: [note(64), note(67), note(69), note(71), note(72)],
        accompanimentEvents: [note(36), note(43), note(48), note(43)],
    });
    const result = repairPianoSection(artifact);
    assert.equal(result.repaired, false);
    assert.equal(result.repairCount, 0);
    assert.equal(result.actions.length, 0);
});

test("repairPianoSection: multiple problems are all fixed in one pass", () => {
    const artifact = section({
        // RH: note below floor (36), leap of 24, wide chord
        melodyEvents: [note(36), note(60), chord([48, 55, 64, 72, 76, 80, 84, 88])],
        // LH: note above ceiling (80), no bass
        accompanimentEvents: [note(80), note(72), note(68)],
        pianoPedalBlurRisk: 0.90,
    });
    const result = repairPianoSection(artifact);
    assert.ok(result.repaired);
    assert.ok(result.repairCount > 1, `expected multiple repairs, got ${result.repairCount}`);
    // RH note should no longer be below 48
    const rhPitches = result.updatedArtifact.melodyEvents.flatMap((ev) =>
        ev.type === "chord" ? (ev.pitches ?? []) : [ev.pitch].filter(Boolean)
    );
    assert.ok(Math.min(...rhPitches) >= 48, "RH should be above floor after repair");
});

test("repairPianoSection: enabledRepairs limits scope", () => {
    // Out-of-range RH note but we only enable chord_thinning → should not be fixed
    const artifact = section({ melodyEvents: [note(24)] }); // 24 = C1, way below floor
    const result = repairPianoSection(artifact, {
        enabledRepairs: ["chord_thinning"],
    });
    assert.equal(result.repaired, false, "register fix should be disabled");
    assert.equal(result.updatedArtifact.melodyEvents[0].pitch, 24);
});

test("repairPianoSection: updatedArtifact has refreshed projection evidence", () => {
    // After repair, projection fields should be recomputed
    const artifact = section({
        melodyEvents: [note(36), note(40), note(44)], // below RH floor 48
        accompanimentEvents: [note(60), note(64)],
    });
    const result = repairPianoSection(artifact, { enabledRepairs: ["register_correction"] });
    // Before repair: RH min would be 36; after: should be 48+
    const updatedMin = result.updatedArtifact.pianoRightHandPitchMin;
    if (updatedMin !== undefined) {
        assert.ok(updatedMin >= 48, `projection should show RH min >= 48 after repair, got ${updatedMin}`);
    }
});

// ─── Integration: repairPianoCandidates ──────────────────────────────────────

test("repairPianoCandidates: repairs all sections and returns repairedArtifacts", () => {
    const artifacts = [
        section({ sectionId: "s1", melodyEvents: [note(36)] }),  // needs register fix
        section({ sectionId: "s2", melodyEvents: [note(64)] }),  // idiomatic
    ];
    const { results, anyRepaired, repairedArtifacts } = repairPianoCandidates(artifacts);

    assert.equal(results.length, 2);
    assert.equal(repairedArtifacts.length, 2);
    assert.ok(anyRepaired, "at least one section should be repaired");
    assert.equal(results[0].repaired, true);
    assert.equal(results[1].repaired, false);
});

test("repairPianoCandidates: empty array returns no repairs", () => {
    const { results, anyRepaired, repairedArtifacts } = repairPianoCandidates([]);
    assert.equal(results.length, 0);
    assert.equal(repairedArtifacts.length, 0);
    assert.equal(anyRepaired, false);
});
