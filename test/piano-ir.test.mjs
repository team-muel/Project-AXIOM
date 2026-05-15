import test from "node:test";
import assert from "node:assert/strict";
import {
    validatePianoHandPlan,
    validatePianoPedalPlan,
    validatePianoSectionPlan,
    validatePianoPlan,
    buildDefaultPianoHandPlan,
    buildDefaultPianoPedalPlan,
    buildDefaultPianoSectionPlan,
    buildPianoPlanFromCompositionPlan,
    getTextureTemplate,
    buildPianoSectionPlanFromTemplate,
    buildPianoSectionPlanForStyle,
} from "../dist/pipeline/pianoIR.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validRH(overrides = {}) {
    return {
        hand: "right",
        primaryRoles: ["lead"],
        registerMin: 64,
        registerMax: 88,
        maxComfortableSpan: 12,
        ...overrides,
    };
}

function validLH(overrides = {}) {
    return {
        hand: "left",
        primaryRoles: ["bass"],
        registerMin: 36,
        registerMax: 60,
        maxComfortableSpan: 12,
        ...overrides,
    };
}

function validPedal(overrides = {}) {
    return { enabled: true, strategy: "harmonic", changeOnHarmony: true, ...overrides };
}

function validSectionPlan(id = "s1", overrides = {}) {
    return {
        sectionId: id,
        textureKind: "melody_accompaniment",
        rightHand: validRH(),
        leftHand: validLH(),
        pedal: validPedal(),
        difficultyTarget: "intermediate",
        ...overrides,
    };
}

function minimalCompositionPlan(sections = []) {
    return {
        version: "1",
        brief: "test",
        mood: [],
        form: "miniature",
        workflow: "full",
        instrumentation: [{ name: "Piano", roles: ["lead"] }],
        motifPolicy: {},
        sections,
        rationale: "test",
    };
}

// ─── validatePianoHandPlan ─────────────────────────────────────────────────────

test("validatePianoHandPlan passes clean RH plan", () => {
    const issues = validatePianoHandPlan(validRH());
    assert.deepEqual(issues, []);
});

test("validatePianoHandPlan passes clean LH plan", () => {
    const issues = validatePianoHandPlan(validLH());
    assert.deepEqual(issues, []);
});

test("validatePianoHandPlan flags RH registerMin below C4", () => {
    const issues = validatePianoHandPlan(validRH({ registerMin: 55 }));
    assert.ok(issues.some((i) => i.includes("registerMin 55")));
});

test("validatePianoHandPlan flags LH registerMax above C5", () => {
    const issues = validatePianoHandPlan(validLH({ registerMax: 76 }));
    assert.ok(issues.some((i) => i.includes("registerMax 76")));
});

test("validatePianoHandPlan flags inverted register range", () => {
    const issues = validatePianoHandPlan(validRH({ registerMin: 80, registerMax: 70 }));
    assert.ok(issues.some((i) => i.includes("must be less than registerMax")));
});

test("validatePianoHandPlan flags span exceeding hard ceiling (19)", () => {
    const issues = validatePianoHandPlan(validRH({ maxComfortableSpan: 22 }));
    assert.ok(issues.some((i) => i.includes("hard ceiling")));
});

test("validatePianoHandPlan flags zero span", () => {
    const issues = validatePianoHandPlan(validRH({ maxComfortableSpan: 0 }));
    assert.ok(issues.some((i) => i.includes("> 0")));
});

test("validatePianoHandPlan flags empty roles", () => {
    const issues = validatePianoHandPlan(validRH({ primaryRoles: [] }));
    assert.ok(issues.some((i) => i.includes("primaryRoles")));
});

test("validatePianoHandPlan flags densityTarget out of range", () => {
    const issues = validatePianoHandPlan(validRH({ densityTarget: 8 }));
    assert.ok(issues.some((i) => i.includes("densityTarget")));
});

// ─── validatePianoPedalPlan ───────────────────────────────────────────────────

test("validatePianoPedalPlan passes harmonic strategy", () => {
    const issues = validatePianoPedalPlan(validPedal());
    assert.deepEqual(issues, []);
});

test("validatePianoPedalPlan flags enabled=true with strategy=none", () => {
    const issues = validatePianoPedalPlan({ enabled: true, strategy: "none" });
    assert.ok(issues.some((i) => i.includes('strategy is "none" but enabled is true')));
});

test("validatePianoPedalPlan flags enabled=false with non-none strategy", () => {
    const issues = validatePianoPedalPlan({ enabled: false, strategy: "legato" });
    assert.ok(issues.some((i) => i.includes("enabled is false")));
});

test("validatePianoPedalPlan flags changeOnHarmony=true with non-harmonic strategy", () => {
    const issues = validatePianoPedalPlan({ enabled: true, strategy: "legato", changeOnHarmony: true });
    assert.ok(issues.some((i) => i.includes('requires strategy="harmonic"')));
});

test("validatePianoPedalPlan flags maxPedalMeasures < 1", () => {
    const issues = validatePianoPedalPlan({ enabled: true, strategy: "legato", maxPedalMeasures: 0 });
    assert.ok(issues.some((i) => i.includes("maxPedalMeasures")));
});

// ─── validatePianoSectionPlan ─────────────────────────────────────────────────

test("validatePianoSectionPlan passes a clean section plan", () => {
    const issues = validatePianoSectionPlan(validSectionPlan());
    assert.deepEqual(issues, []);
});

test("validatePianoSectionPlan flags empty sectionId", () => {
    const issues = validatePianoSectionPlan(validSectionPlan("   "));
    assert.ok(issues.some((i) => i.includes("sectionId")));
});

test("validatePianoSectionPlan flags LH/RH register overlap without allowCrossing", () => {
    const issues = validatePianoSectionPlan(validSectionPlan("s1", {
        rightHand: validRH({ registerMin: 55 }),
        leftHand: validLH({ registerMax: 65 }),
    }));
    assert.ok(issues.some((i) => i.includes("overlaps or exceeds")));
});

test("validatePianoSectionPlan allows overlap when allowCrossing=true", () => {
    const issues = validatePianoSectionPlan(validSectionPlan("s1", {
        rightHand: validRH({ registerMin: 60, allowCrossing: true }),
        leftHand: validLH({ registerMax: 65, allowCrossing: true }),
    }));
    assert.ok(!issues.some((i) => i.includes("overlaps")));
});

test("validatePianoSectionPlan flags alberti_bass without bass/pulse in LH", () => {
    const issues = validatePianoSectionPlan(validSectionPlan("s1", {
        textureKind: "alberti_bass",
        leftHand: validLH({ primaryRoles: ["inner_voice"] }),
    }));
    assert.ok(issues.some((i) => i.includes('"alberti_bass"')));
});

test("validatePianoSectionPlan flags octave_melody without lead in RH", () => {
    const issues = validatePianoSectionPlan(validSectionPlan("s1", {
        textureKind: "octave_melody",
        rightHand: validRH({ primaryRoles: ["inner_voice"] }),
    }));
    assert.ok(issues.some((i) => i.includes('"octave_melody"')));
});

// ─── validatePianoPlan ────────────────────────────────────────────────────────

test("validatePianoPlan passes a minimal valid plan", () => {
    const issues = validatePianoPlan({
        instrument: "Piano",
        difficultyTarget: "intermediate",
        sections: [validSectionPlan()],
    });
    assert.deepEqual(issues, []);
});

test("validatePianoPlan flags wrong instrument", () => {
    const issues = validatePianoPlan({
        instrument: "Violin",
        difficultyTarget: "easy",
        sections: [validSectionPlan()],
    });
    assert.ok(issues.some((i) => i.includes('instrument must be "Piano"')));
});

test("validatePianoPlan flags empty sections array", () => {
    const issues = validatePianoPlan({
        instrument: "Piano",
        difficultyTarget: "easy",
        sections: [],
    });
    assert.ok(issues.some((i) => i.includes("sections array must not be empty")));
});

test("validatePianoPlan flags duplicate sectionId", () => {
    const issues = validatePianoPlan({
        instrument: "Piano",
        difficultyTarget: "intermediate",
        sections: [validSectionPlan("s1"), validSectionPlan("s1")],
    });
    assert.ok(issues.some((i) => i.includes('duplicate sectionId "s1"')));
});

test("validatePianoPlan flags section difficulty exceeding plan cap", () => {
    const issues = validatePianoPlan({
        instrument: "Piano",
        difficultyTarget: "easy",
        sections: [validSectionPlan("s1", { difficultyTarget: "advanced" })],
    });
    assert.ok(issues.some((i) => i.includes("exceeds plan-level cap")));
});

// ─── buildDefaultPianoHandPlan ────────────────────────────────────────────────

test("buildDefaultPianoHandPlan RH is within idiomatic range", () => {
    const plan = buildDefaultPianoHandPlan("right", "intermediate");
    assert.equal(plan.hand, "right");
    assert.ok(plan.registerMin >= 60);
    assert.ok(plan.registerMax <= 108);
    assert.ok(plan.primaryRoles.length > 0);
    // Should be valid
    assert.deepEqual(validatePianoHandPlan(plan), []);
});

test("buildDefaultPianoHandPlan LH is within idiomatic range", () => {
    const plan = buildDefaultPianoHandPlan("left", "advanced");
    assert.equal(plan.hand, "left");
    assert.ok(plan.registerMin >= 24);
    assert.ok(plan.registerMax <= 72);
    assert.deepEqual(validatePianoHandPlan(plan), []);
});

test("buildDefaultPianoHandPlan span increases with difficulty", () => {
    const easy = buildDefaultPianoHandPlan("right", "easy");
    const virtuosic = buildDefaultPianoHandPlan("right", "virtuosic");
    assert.ok(virtuosic.maxComfortableSpan > easy.maxComfortableSpan);
});

// ─── buildDefaultPianoPedalPlan ───────────────────────────────────────────────

test("buildDefaultPianoPedalPlan toccata → no pedal", () => {
    const plan = buildDefaultPianoPedalPlan("toccata");
    assert.equal(plan.enabled, false);
    assert.equal(plan.strategy, "none");
});

test("buildDefaultPianoPedalPlan nocturne → legato pedal", () => {
    const plan = buildDefaultPianoPedalPlan("nocturne");
    assert.equal(plan.enabled, true);
    assert.equal(plan.strategy, "legato");
});

test("buildDefaultPianoPedalPlan alberti_bass → harmonic pedal", () => {
    const plan = buildDefaultPianoPedalPlan("alberti_bass");
    assert.equal(plan.enabled, true);
    assert.equal(plan.strategy, "harmonic");
    assert.equal(plan.changeOnHarmony, true);
});

// ─── buildDefaultPianoSectionPlan ─────────────────────────────────────────────

test("buildDefaultPianoSectionPlan passes validation", () => {
    for (const kind of [
        "melody_accompaniment", "chorale", "alberti_bass", "waltz_bass",
        "counterpoint_two_voice", "nocturne", "toccata",
    ]) {
        const plan = buildDefaultPianoSectionPlan("s1", kind, "intermediate");
        const issues = validatePianoSectionPlan(plan);
        assert.deepEqual(issues, [], `${kind}: ${issues.join("; ")}`);
    }
});

test("buildDefaultPianoSectionPlan chorale sets high density in both hands", () => {
    const plan = buildDefaultPianoSectionPlan("s1", "chorale", "intermediate");
    assert.ok(plan.rightHand.densityTarget >= 2);
    assert.ok(plan.leftHand.densityTarget >= 2);
});

test("buildDefaultPianoSectionPlan counterpoint_two_voice assigns counterline to LH", () => {
    const plan = buildDefaultPianoSectionPlan("s1", "counterpoint_two_voice", "advanced");
    assert.ok(plan.leftHand.primaryRoles.includes("counterline"));
    assert.ok(plan.rightHand.primaryRoles.includes("lead"));
});

// ─── buildPianoPlanFromCompositionPlan ────────────────────────────────────────

test("buildPianoPlanFromCompositionPlan produces a valid plan for typical sections", () => {
    const compositionPlan = minimalCompositionPlan([
        { id: "theme", role: "theme_a", label: "Theme A", measures: 8, energy: 0.7, density: 0.6 },
        { id: "dev",   role: "development", label: "Dev", measures: 8, energy: 0.9, density: 0.8 },
        { id: "cadence", role: "cadence", label: "Cadence", measures: 4, energy: 0.5, density: 0.4 },
    ]);

    const pianoPlan = buildPianoPlanFromCompositionPlan(compositionPlan, "intermediate");
    assert.equal(pianoPlan.instrument, "Piano");
    assert.equal(pianoPlan.sections.length, 3);

    const issues = validatePianoPlan(pianoPlan);
    assert.deepEqual(issues, [], `Plan validation failed: ${issues.join("; ")}`);
});

test("buildPianoPlanFromCompositionPlan assigns chorale to cadence sections", () => {
    const compositionPlan = minimalCompositionPlan([
        { id: "cadence", role: "cadence", label: "Cadence", measures: 4, energy: 0.4, density: 0.3 },
    ]);
    const pianoPlan = buildPianoPlanFromCompositionPlan(compositionPlan, "easy");
    assert.equal(pianoPlan.sections[0].textureKind, "chorale");
});

test("buildPianoPlanFromCompositionPlan assigns broken_chord to development sections", () => {
    const compositionPlan = minimalCompositionPlan([
        { id: "dev", role: "development", label: "Dev", measures: 8, energy: 0.9, density: 0.8 },
    ]);
    const pianoPlan = buildPianoPlanFromCompositionPlan(compositionPlan, "advanced");
    assert.equal(pianoPlan.sections[0].textureKind, "broken_chord");
});

test("buildPianoPlanFromCompositionPlan assigns melody_accompaniment to theme", () => {
    const compositionPlan = minimalCompositionPlan([
        { id: "theme_a", role: "theme_a", label: "Theme A", measures: 8, energy: 0.7, density: 0.6 },
    ]);
    const pianoPlan = buildPianoPlanFromCompositionPlan(compositionPlan, "intermediate");
    assert.equal(pianoPlan.sections[0].textureKind, "melody_accompaniment");
});

test("buildPianoPlanFromCompositionPlan empty sections produces valid plan", () => {
    const compositionPlan = minimalCompositionPlan([]);
    const pianoPlan = buildPianoPlanFromCompositionPlan(compositionPlan, "easy");
    assert.equal(pianoPlan.sections.length, 0);
    // Empty sections is an IR-level concern, not builder concern
    assert.equal(pianoPlan.instrument, "Piano");
});

// ─── getTextureTemplate ────────────────────────────────────────────────────────

test("getTextureTemplate: alberti_bass has correct accompanimentPattern and styleHints", () => {
    const tpl = getTextureTemplate("alberti_bass");
    assert.equal(tpl.textureKind, "alberti_bass");
    assert.equal(tpl.accompanimentPattern, "alberti_bass");
    assert.ok(tpl.styleHints.includes("classical_sonata"), "alberti_bass should hint classical_sonata");
});

test("getTextureTemplate: nocturne has spread voicing, legato pedal, no change-on-harmony", () => {
    const tpl = getTextureTemplate("nocturne");
    assert.equal(tpl.voicingStrategy, "spread");
    assert.equal(tpl.pedalStrategy, "legato");
    assert.ok(!tpl.pedalChangeOnHarmony, "nocturne should not have pedalChangeOnHarmony");
    assert.ok(tpl.styleHints.includes("nocturne"));
});

test("getTextureTemplate: toccata has no pedal and allowRepeatedOctaves", () => {
    const tpl = getTextureTemplate("toccata");
    assert.equal(tpl.pedalStrategy, "none");
    assert.equal(tpl.allowRepeatedOctaves, true);
});

test("getTextureTemplate: etude_figuration has no pedal", () => {
    const tpl = getTextureTemplate("etude_figuration");
    assert.equal(tpl.pedalStrategy, "none");
    assert.equal(tpl.accompanimentPattern, "repeated_figure");
});

test("getTextureTemplate: counterpoint_two_voice has single-note density on both hands", () => {
    const tpl = getTextureTemplate("counterpoint_two_voice");
    assert.equal(tpl.rhDensityTarget, 1);
    assert.equal(tpl.lhDensityTarget, 1);
    assert.ok(tpl.lhRoles.includes("counterline"));
});

test("getTextureTemplate: chorale has inner_voice in both hands", () => {
    const tpl = getTextureTemplate("chorale");
    assert.ok(tpl.rhRoles.includes("inner_voice"));
    assert.ok(tpl.lhRoles.includes("inner_voice"));
    assert.equal(tpl.accompanimentPattern, "block_chord");
});

// ─── buildPianoSectionPlanFromTemplate ────────────────────────────────────────

test("buildPianoSectionPlanFromTemplate: all 12 texture kinds pass validation", () => {
    const ALL_KINDS = [
        "melody_accompaniment", "chorale", "alberti_bass", "broken_chord",
        "arpeggiated_texture", "octave_melody", "counterpoint_two_voice",
        "counterpoint_three_voice", "waltz_bass", "toccata", "nocturne", "etude_figuration",
    ];
    for (const kind of ALL_KINDS) {
        const plan = buildPianoSectionPlanFromTemplate("s1", kind, "intermediate");
        const issues = validatePianoSectionPlan(plan);
        assert.deepEqual(issues, [], `${kind}: ${issues.join("; ")}`);
    }
});

test("buildPianoSectionPlanFromTemplate: alberti_bass sets accompanimentPattern and roles", () => {
    const plan = buildPianoSectionPlanFromTemplate("theme-a", "alberti_bass", "easy");
    assert.equal(plan.textureKind, "alberti_bass");
    assert.equal(plan.accompanimentPattern, "alberti_bass");
    assert.ok(plan.leftHand.primaryRoles.includes("pulse"), "LH should include pulse");
    assert.ok(plan.leftHand.primaryRoles.includes("bass"), "LH should include bass");
});

test("buildPianoSectionPlanFromTemplate: nocturne sets spread voicing and legato pedal", () => {
    const plan = buildPianoSectionPlanFromTemplate("intro", "nocturne", "intermediate");
    assert.equal(plan.voicingStrategy, "spread");
    assert.equal(plan.pedal.strategy, "legato");
    assert.equal(plan.pedal.enabled, true);
    assert.equal(plan.accompanimentPattern, "wide_spread_arpeggio");
});

test("buildPianoSectionPlanFromTemplate: toccata disables pedal", () => {
    const plan = buildPianoSectionPlanFromTemplate("drive", "toccata", "advanced");
    assert.equal(plan.pedal.enabled, false);
    assert.equal(plan.pedal.strategy, "none");
    assert.equal(plan.rightHand.allowRepeatedOctaves, true);
});

test("buildPianoSectionPlanFromTemplate: chorale has high density in both hands", () => {
    const plan = buildPianoSectionPlanFromTemplate("cad", "chorale", "intermediate");
    assert.ok(plan.rightHand.densityTarget >= 2, "RH density should be >= 2");
    assert.ok(plan.leftHand.densityTarget >= 2, "LH density should be >= 2");
    assert.equal(plan.accompanimentPattern, "block_chord");
});

test("buildPianoSectionPlanFromTemplate: difficulty controls span", () => {
    const easy  = buildPianoSectionPlanFromTemplate("s1", "melody_accompaniment", "easy");
    const virt  = buildPianoSectionPlanFromTemplate("s1", "melody_accompaniment", "virtuosic");
    assert.ok(virt.rightHand.maxComfortableSpan > easy.rightHand.maxComfortableSpan);
});

// ─── buildPianoSectionPlanForStyle ────────────────────────────────────────────

test("buildPianoSectionPlanForStyle: classical_sonata theme_a → alberti_bass", () => {
    const plan = buildPianoSectionPlanForStyle("theme-a", "classical_sonata", "theme_a");
    assert.equal(plan.textureKind, "alberti_bass");
    assert.deepEqual(validatePianoSectionPlan(plan), []);
});

test("buildPianoSectionPlanForStyle: classical_sonata cadence → chorale", () => {
    const plan = buildPianoSectionPlanForStyle("cad", "classical_sonata", "cadence");
    assert.equal(plan.textureKind, "chorale");
});

test("buildPianoSectionPlanForStyle: nocturne any role → nocturne texture", () => {
    const plan = buildPianoSectionPlanForStyle("main", "nocturne", "theme_a");
    assert.equal(plan.textureKind, "nocturne");
    assert.equal(plan.pedal.strategy, "legato");
});

test("buildPianoSectionPlanForStyle: nocturne climax → octave_melody", () => {
    const plan = buildPianoSectionPlanForStyle("climax", "nocturne", "climax");
    assert.equal(plan.textureKind, "octave_melody");
});

test("buildPianoSectionPlanForStyle: etude development → etude_figuration", () => {
    const plan = buildPianoSectionPlanForStyle("dev", "etude", "development");
    assert.equal(plan.textureKind, "etude_figuration");
    assert.equal(plan.pedal.enabled, false);
});

test("buildPianoSectionPlanForStyle: romantic_character climax → octave_melody", () => {
    const plan = buildPianoSectionPlanForStyle("climax", "romantic_character", "climax");
    assert.equal(plan.textureKind, "octave_melody");
    assert.equal(plan.voicingStrategy, "octave_doubled");
});

test("buildPianoSectionPlanForStyle: unknown role falls back to theme_a texture", () => {
    const plan = buildPianoSectionPlanForStyle("x", "classical_sonata", "unknown_role");
    // falls back to theme_a = alberti_bass
    assert.equal(plan.textureKind, "alberti_bass");
});

// ─── Expanded texture-role validation ─────────────────────────────────────────

test("validatePianoSectionPlan flags nocturne without bass/chordal_support in LH", () => {
    const plan = validSectionPlan("s1", {
        textureKind: "nocturne",
        leftHand: validLH({ primaryRoles: ["counterline"] }),
    });
    const issues = validatePianoSectionPlan(plan);
    assert.ok(issues.some((i) => i.includes('"nocturne"')), `Expected nocturne error, got: ${issues}`);
});

test("validatePianoSectionPlan flags arpeggiated_texture without bass in LH", () => {
    const plan = validSectionPlan("s1", {
        textureKind: "arpeggiated_texture",
        leftHand: validLH({ primaryRoles: ["pulse"] }),
    });
    const issues = validatePianoSectionPlan(plan);
    assert.ok(issues.some((i) => i.includes('"arpeggiated_texture"')));
});

test("validatePianoSectionPlan flags chorale without inner_voice in RH", () => {
    const plan = validSectionPlan("s1", {
        textureKind: "chorale",
        rightHand: validRH({ primaryRoles: ["pulse"] }),
        leftHand: validLH({ primaryRoles: ["inner_voice", "bass"], registerMax: 58 }),
    });
    const issues = validatePianoSectionPlan(plan);
    assert.ok(issues.some((i) => i.includes('"chorale"') && i.includes("RH")));
});

test("validatePianoSectionPlan flags toccata without pulse in any hand", () => {
    const plan = validSectionPlan("s1", {
        textureKind: "toccata",
        rightHand: validRH({ primaryRoles: ["lead"] }),
        leftHand: validLH({ primaryRoles: ["bass"] }),
        pedal: { enabled: false, strategy: "none" },
    });
    const issues = validatePianoSectionPlan(plan);
    assert.ok(issues.some((i) => i.includes('"toccata"') && i.includes("pulse")));
});

test("validatePianoSectionPlan: valid etude_figuration plan with pulse passes", () => {
    const plan = buildPianoSectionPlanFromTemplate("s1", "etude_figuration", "advanced");
    const issues = validatePianoSectionPlan(plan);
    assert.deepEqual(issues, []);
});
