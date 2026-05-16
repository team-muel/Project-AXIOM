import type { TextureRole } from "./expression.js";
import type { SectionArtifactSummary, SectionPlan } from "./section.js";
import type { CraftScoreSummary, RevisionDirectiveKind } from "./evaluation.js";
import type { ApprovalStatus, CompositionPlan, ListenerFeedback } from "./composition.js";

/**
 * Piano-specific revision directive kinds.
 *
 * These extend the general RevisionDirectiveKind set with hand-aware
 * and texture-specific repairs.  Used in LocalizedPianoRewriteSpec to
 * describe exactly what needs to change in the piano idiom without
 * clobbering the generic revision pathway.
 */
export type PianoRevisionDirectiveKind =
    | "reduce_hand_span"
    | "smooth_left_hand_leaps"
    | "clarify_right_hand_melody"
    | "strengthen_left_hand_bass"
    | "thin_overdense_chords"
    | "improve_pedal_changes"
    | "separate_registers"
    | "increase_accompaniment_consistency"
    | "reduce_hand_crossing"
    | "make_texture_more_pianistic";

/**
 * A single piano revision directive.
 *
 * `repairSolver`: the repair can be fully handled by PianoRepairSolver
 *                 without a re-generation pass.
 * `rewrite`:      the section needs re-generation (via fine-tuned model
 *                 or NotaGen fallback).
 * `either`:       repair is preferred but rewrite is acceptable.
 */
export interface PianoRevisionDirective {
    kind: PianoRevisionDirectiveKind;
    priority: number;
    reason: string;
    sectionIds?: string[];
    /**
     * Execution strategy for this directive.
     *
     * `repairSolver` — route to PianoRepairSolver (no rewrite call).
     * `rewrite`      — route to NotaGen localized rewrite (fine-tuned or fallback).
     * `either`       — PianoRepairSolver preferred; fall back to rewrite if score unchanged.
     */
    fallbackStrategy?: "repairSolver" | "rewrite" | "either";
}

/** Specification for a piano localized section rewrite request. */
export interface LocalizedPianoRewriteSpec {
    rewriteSectionIds: string[];
    keepSectionIds: string[];
    reason: string;
    directives: PianoRevisionDirective[];
    previousAbcText?: string;
    /**
     * When `true`, the caller has already applied PianoRepairSolver to the
     * candidate and this spec represents the residual issues that repair
     * could not fix.  The rewrite prompt can assume register and span
     * corrections are already applied.
     */
    repairAlreadyApplied?: boolean;
}

export interface PianoVoiceLayoutSummary {
    /**
     * Minimum MIDI pitch observed in the right-hand voice(s).
     * Idiomatic range upper boundary: C4 (60) – C8 (108).
     */
    rightHandPitchMin?: number;
    rightHandPitchMax?: number;
    /**
     * Minimum MIDI pitch observed in the left-hand voice(s).
     * Idiomatic range lower boundary: C1 (24) – C5 (72).
     */
    leftHandPitchMin?: number;
    leftHandPitchMax?: number;
    /**
     * Maximum simultaneous interval span observed within a single hand (semitones).
     * Spans > 19 (a minor 13th) are generally unplayable without arpeggiation.
     */
    maxRightHandSpan?: number;
    maxLeftHandSpan?: number;
    /**
     * Number of events where the left-hand top note is higher than the
     * right-hand bottom note (hand crossing).
     */
    handCrossingCount?: number;
    /**
     * Number of events where left and right hands collide on the same pitch
     * within the same beat.
     */
    handCollisionCount?: number;
    /** Average simultaneous voice count across all chordal events. */
    avgChordVoiceCount?: number;
    /**
     * Number of events that carry explicit pedal markings or are flagged for
     * pedal use by the humanizer.
     */
    pedalEventCount?: number;
    /**
     * Proportion of chordal events that are within playable span thresholds (0–1).
     */
    playableSpanFit?: number;
    notes?: string[];
}

/**
 * Piano craft score summary.
 *
 * Dimension weights (sum = 1.00):
 *   handPlayability              0.20  — gate dimension; unplayable ≠ piano
 *   melodicClarity               0.15
 *   bassCoherence                0.15
 *   voicingIdiomaticFit          0.12
 *   accompanimentPatternCoherence 0.12
 *   registerSpacing              0.10
 *   handIndependence             0.08
 *   pedalPlausibility            0.05
 *   difficultyFit                0.03
 *   ─────────────────────────────────
 *   total                        1.00
 */
export interface PianoCraftScoreSummary {
    /** Proportion of chordal events within playable span. Weight: 0.20. */
    handPlayability: number;
    /**
     * Right-hand melodic clarity: small average leaps, moderate density,
     * smooth contour. Incorporates leap penalty. Weight: 0.15.
     */
    melodicClarity: number;
    /**
     * Left-hand bass coherence: stepwise / pedal bass rewarded; leaping
     * LH penalised; bass pitch out of LH zone penalised. Weight: 0.15.
     */
    bassCoherence: number;
    /**
     * Idiomatic chord voicing: voice count fit + awkward-span ratio.
     * Replaces the former chordDensity + excessiveLeapPenalty split.
     * Weight: 0.12.
     */
    voicingIdiomaticFit: number;
    /**
     * Rhythmic regularity and pattern stability of accompaniment (LH).
     * Weight: 0.12.
     */
    accompanimentPatternCoherence: number;
    /**
     * Register separation between RH median and LH median (idiomatic spread).
     * Weight: 0.10.
     */
    registerSpacing: number;
    /**
     * Independence of the two hands: rewards density balance and contrary
     * motion; penalises one hand dominating or mirroring the other.
     * Weight: 0.08.
     */
    handIndependence: number;
    /**
     * Plausibility of pedal use given section texture and dynamics.
     * Weight: 0.05.
     */
    pedalPlausibility: number;
    /**
     * Fit between the plan's difficultyTarget and the realised span / density.
     * Weight: 0.03.
     */
    difficultyFit: number;
    /** Weighted composite (weights above sum to 1.00). */
    finalPianoScore: number;
    /** Optional per-dimension human-readable notes keyed by dimension name. */
    dimensionNotes?: Record<string, string>;

    // ── Supplementary listenability metrics ──────────────────────────────────

    /**
     * Melody prominence: right-hand pitch register and velocity sit clearly
     * above accompaniment. Higher = melody is audible and stands out (0–1).
     */
    melodyProminenceScore?: number;
    /**
     * Pedal blur risk (inverted): 1 = very low blur risk, 0 = high risk.
     * Estimated from pedal event density + LH chord density in low register.
     */
    pedalBlurRisk?: number;
    /**
     * Bass root support: LH pitch concentrates in bass register (C2–E3 /
     * MIDI 36–52), providing harmonic grounding. Higher = better (0–1).
     */
    bassRootSupportScore?: number;
    /**
     * Texture-form coherence: accompaniment complexity tracks formal role
     * (development denser than theme_a, recap matches theme_a, etc.). (0–1).
     */
    textureFormCoherenceScore?: number;
    /**
     * Piano listenability composite score: six listener-facing dimensions
     * (melody prominence, bass root support, accompaniment consistency,
     * register spacing, pedal blur risk, texture-form coherence) weighted
     * to reflect what human listeners notice most. (0–1).
     */
    pianoListenabilityScore?: number;
}

// ─── Piano Intermediate Representation (Piano IR) ────────────────────────────
//
// PianoIR is the hand-aware planning layer between a CompositionPlan and the
// symbolic backend.  It answers questions that SectionArtifactSummary cannot:
//   • Which hand plays what register range?
//   • Is a given chord span playable without arpeggiation?
//   • What texture/pattern does each hand use per section?
//   • What is the pedal strategy?
//
// PianoPlan is attached to CompositionPlan as an optional field.  Its presence
// signals to the compose pipeline that the request must go through the piano
// lane (once activated) rather than the generic learned-symbolic lane.

export type PianoDifficulty = "easy" | "intermediate" | "advanced" | "virtuosic";

/**
 * Texture vocabulary for a single piano section.
 *
 * melody_accompaniment   — RH melody + LH Alberti/chord/broken-chord pattern
 * chorale                — four-part chorale-style (SATB-ish), both hands chords
 * alberti_bass           — classic Alberti bass in LH, singable melody in RH
 * broken_chord           — LH or RH broken arpeggiated chord (not Alberti pattern)
 * arpeggiated_texture    — both hands use rolled/arpeggio chords throughout
 * octave_melody          — RH melody doubled at octave; LH bass
 * counterpoint_two_voice — strict two-voice counterpoint (one voice per hand)
 * counterpoint_three_voice — three voices distributed across two hands
 * waltz_bass             — LH: bass note on beat 1 + chord on beats 2–3; RH melody
 * toccata                — fast repeated-note / perpetual-motion texture
 * nocturne               — LH wide arpeggios + RH ornamental cantabile melody
 * etude_figuration       — one hand plays a technical figuration pattern throughout
 */
export type PianoTextureKind =
    | "melody_accompaniment"
    | "chorale"
    | "alberti_bass"
    | "broken_chord"
    | "arpeggiated_texture"
    | "octave_melody"
    | "counterpoint_two_voice"
    | "counterpoint_three_voice"
    | "waltz_bass"
    | "toccata"
    | "nocturne"
    | "etude_figuration";

/**
 * Discrete accompaniment pattern identifiers.
 *
 * Used in PianoSectionPlan.accompanimentPattern to constrain prompts and
 * drive texture-coherence validation.
 */
export type AccompanimentPattern =
    | "alberti_bass"
    | "broken_chord"
    | "arpeggiated"
    | "wide_spread_arpeggio"
    | "block_chord"
    | "waltz_bass"
    | "octave_bass"
    | "scale_passage"
    | "repeated_figure"
    | "inner_voice_sigh"
    | "ornamental_turns"
    | "tremolo_octave";

/**
 * High-level piano style paradigms that map to texture sequences.
 *
 * classical_sonata    — Alberti bass / broken chord / counterpoint / chorale
 * romantic_character  — melody + wide arpeggiation / inner-voice / octave melody
 * nocturne            — cantabile melody / spread LH waves / sustained pedal
 * etude               — repeated figuration / toccata / progressive difficulty
 */
export type PianoStyleKind = "classical_sonata" | "romantic_character" | "nocturne" | "etude";

/**
 * Plan for one hand within a section.
 *
 * registerMin / registerMax are MIDI pitch numbers (inclusive).
 * maxComfortableSpan is the largest simultaneous chord span allowed for this
 * hand without requiring an arpeggiation marking (semitones; default 10 for
 * non-virtuosic writing, up to 19 for concert-level).
 */
export interface PianoHandPlan {
    hand: "left" | "right";
    /** Voice roles this hand is responsible for in the section. */
    primaryRoles: TextureRole[];
    /** Lowest MIDI pitch intended for this hand (inclusive). */
    registerMin: number;
    /** Highest MIDI pitch intended for this hand (inclusive). */
    registerMax: number;
    /**
     * Maximum simultaneous chord span in semitones before an arpeggio mark
     * is required.  19 = minor 13th (hard playability ceiling).
     */
    maxComfortableSpan: number;
    /** Whether intentional hand-crossing into the other hand's register is planned. */
    allowCrossing?: boolean;
    /** Whether repeated-octave tremolo figures are intended (e.g. toccata texture). */
    allowRepeatedOctaves?: boolean;
    /**
     * Target average simultaneous voice count for this hand per beat (1–6).
     * 1 = single-note line, 4 = full chord, 6 = dense concert texture.
     */
    densityTarget?: number;
}

/**
 * Pedal strategy for a section or movement.
 *
 * none       — no sustain pedal (staccato, early-keyboard style)
 * harmonic   — change pedal exactly on each harmony change
 * legato     — sustain pedal throughout most of the section (blur acceptable)
 * half_pedal — flutter / half-damper technique for colouristic effect
 * coloristic — free pedal beyond harmonic logic (impressionistic, extended technique)
 */
export interface PianoPedalPlan {
    enabled: boolean;
    strategy: "none" | "harmonic" | "legato" | "half_pedal" | "coloristic";
    /** Change pedal on every new harmony event (requires strategy = "harmonic"). */
    changeOnHarmony?: boolean;
    /**
     * Maximum number of consecutive measures where the pedal may be held
     * without change before a warning is emitted.
     */
    maxPedalMeasures?: number;
}

/**
 * Piano-specific plan for a single section.
 *
 * Sits alongside (not inside) SectionPlan so the symbolic backend can resolve
 * exact hand assignments, span checks, and pedal placement for each section
 * without modifying the generic section-planning types.
 */
export interface PianoSectionPlan {
    sectionId: string;
    textureKind: PianoTextureKind;
    rightHand: PianoHandPlan;
    leftHand: PianoHandPlan;
    pedal: PianoPedalPlan;
    /**
     * Discrete accompaniment pattern for this section.
     * Constrains the prompt builder and drives texture-coherence validation.
     */
    accompanimentPattern?: AccompanimentPattern;
    /**
     * Chord voicing strategy for chordal events:
     *   close       — all voices within one octave
     *   open        — voices spread beyond an octave (with gaps)
     *   drop_2      — standard drop-2 voicing (second voice from top dropped an octave)
     *   spread      — wide voicing across two or more octaves
     *   octave_doubled — outer voices doubled at the octave
     */
    voicingStrategy?: "close" | "open" | "drop_2" | "spread" | "octave_doubled";
    difficultyTarget: PianoDifficulty;
}

/**
 * Top-level piano plan attached to a CompositionPlan.
 *
 * Its presence signals to the compose pipeline that all sections must be
 * planned and evaluated through the piano IR layer.
 */
export interface PianoPlan {
    instrument: "Piano";
    difficultyTarget: PianoDifficulty;
    /** One PianoSectionPlan per section in CompositionPlan.sections. */
    sections: PianoSectionPlan[];
}

/**
 * Canonical grammar template for a single PianoTextureKind.
 *
 * Captures the default hand roles, register ranges, density targets,
 * accompaniment pattern, voicing strategy, and pedal strategy that define
 * each texture idiom.  Use `getTextureTemplate()` in pianoIR.ts to retrieve.
 *
 * These templates are the authoritative source for:
 *   • buildPianoSectionPlanFromTemplate()
 *   • buildPianoSectionPlanForStyle()
 *   • texture-coherence validation
 */
export interface PianoTextureTemplate {
    textureKind: PianoTextureKind;
    /** Style idioms this texture is characteristically used in. */
    styleHints: PianoStyleKind[];
    // Right-hand defaults
    rhRoles: TextureRole[];
    rhRegisterMin: number;
    rhRegisterMax: number;
    rhDensityTarget: number;
    // Left-hand defaults
    lhRoles: TextureRole[];
    lhRegisterMin: number;
    lhRegisterMax: number;
    lhDensityTarget: number;
    accompanimentPattern?: AccompanimentPattern;
    voicingStrategy: "close" | "open" | "drop_2" | "spread" | "octave_doubled";
    pedalStrategy: "none" | "harmonic" | "legato" | "half_pedal" | "coloristic";
    pedalChangeOnHarmony?: boolean;
    pedalMaxMeasures?: number;
    allowRepeatedOctaves?: boolean;
    /** Whether LH may extend into the RH register (e.g. chorale inner-voice writing). */
    allowCrossing?: boolean;
    /** One-sentence description of the texture idiom. */
    description: string;
}

/**
 * Captured input fields for one piano generation round.
 *
 * Stored verbatim from the LearnedNotagenProviderRequest so offline training
 * tooling can reconstruct the exact control prompt without re-running the
 * pipeline.
 */
export interface PianoDataLoopInput {
    /** Resolved lane identifier, e.g. "solo_piano_symbolic". */
    lane: string;
    /** Flat list of AXIOM control lines (e.g. "instrumentation=Piano:lead|bass"). */
    controlLines: string[];
    /** "piano_global" control line if emitted (texture, pedal, max_span, etc.). */
    pianoGlobalLine?: string;
    /** All "piano_section" lines indexed by section order. */
    pianoSectionLines?: string[];
    /** Conditioning text (period/composer/form blurb) forwarded to NotaGen. */
    conditioningText?: string;
    /** Canonical instrumentation string from the provider request. */
    instrumentation?: string;
    /** Difficulty label from the provider request. */
    difficulty?: PianoDifficulty;
    /** Key string (e.g. "F minor"). */
    key?: string;
    /** Time signature string (e.g. "6/8"). */
    meter?: string;
    /** Tempo in BPM. */
    tempo?: number;
    /** Musical period from the provider request. */
    period?: string;
    /** Composer hint forwarded to NotaGen. */
    composer?: string;
    /** Form label (e.g. "nocturne", "sonata_allegro"). */
    form?: string;
    /** AXIOM_PIANO_REWRITE block text when a localized rewrite was requested. */
    pianoRewriteBlock?: string;
}

/**
 * Flat piano evidence extracted from SectionArtifactSummary.piano* fields for
 * one candidate.  Stored in the data loop entry for offline analysis.
 */
export interface PianoDataLoopEvidence {
    handSpanMax?: number;
    handSpanAverage?: number;
    playabilityScore?: number;
    idiomaticTextureScore?: number;
    rightHandPitchMin?: number;
    rightHandPitchMax?: number;
    leftHandPitchMin?: number;
    leftHandPitchMax?: number;
    rightHandDensity?: number;
    leftHandDensity?: number;
    chordDensity?: number;
    maxSimultaneousNotes?: number;
    awkwardChordCount?: number;
    handCrossingCount?: number;
    registerCollisionCount?: number;
    repeatedOctaveRate?: number;
    leapMaxRight?: number;
    leapMaxLeft?: number;
    leapAverageRight?: number;
    leapAverageLeft?: number;
    pedalChangeCount?: number;
    pedalBlurRisk?: number;
}

/**
 * One captured piano generation round.
 *
 * Written by savePianoDataLoopEntry() after piano candidate evaluation.
 * Loaded by the four exporters to build fine-tuning datasets.
 */
export interface PianoDataLoopEntry {
    version: 1;
    /** Unique entry ID (uuid-like hash of songId + candidateId + capturedAt). */
    entryId: string;
    songId: string;
    candidateId: string;
    capturedAt: string;
    // ── Input ──────────────────────────────────────────────────────────────────
    input: PianoDataLoopInput;
    pianoPlan?: PianoPlan;
    // ── Output ─────────────────────────────────────────────────────────────────
    /** Full ABC score text produced for this candidate. */
    abcText?: string;
    /** True when a MIDI sidecar was saved alongside the ABC. */
    hasMidi: boolean;
    /** Flat piano-specific evidence fields (aggregated across all sections). */
    pianoEvidence?: PianoDataLoopEvidence;
    /** Piano craft scores for this candidate. */
    pianoCraftScore?: PianoCraftScoreSummary;
    /** General craft scores for this candidate. */
    craftScore?: CraftScoreSummary;
    // ── Human signal ───────────────────────────────────────────────────────────
    listenerFeedback?: ListenerFeedback;
    /** Final approval status.  "approved" entries go into piano_sft_dataset. */
    approvalStatus?: ApprovalStatus;
    // ── Repair / rewrite provenance ────────────────────────────────────────────
    /** True when PianoRepairSolver was applied before this candidate was evaluated. */
    repairApplied?: boolean;
    /** True when a localized piano rewrite was requested for this candidate. */
    rewriteApplied?: boolean;
    /**
     * Piano-specific directives used for the localized rewrite.
     * Populated only when rewriteApplied = true.
     */
    rewriteDirectives?: PianoRevisionDirective[];
    /**
     * Candidate ID of the parent candidate this one was rewritten from.
     * Used by exportPianoRewriteDataset() to build (bad, corrected) pairs.
     */
    parentCandidateId?: string;
    /**
     * Section IDs that were rewritten (from the LocalizedPianoRewriteSpec).
     * Stored so exporters can extract only the changed sections.
     */
    rewrittenSectionIds?: string[];
}

// ─── Dataset export record types ─────────────────────────────────────────────

/**
 * Supervised fine-tuning (SFT) example: AXIOM control block + approved ABC.
 *
 * Training signal: "given this piano control prompt, produce this approved ABC".
 * Populated by exportPianoSftDataset() from entries where approvalStatus = "approved".
 */
export interface PianoSftExample {
    kind: "piano_sft";
    entryId: string;
    songId: string;
    candidateId: string;
    capturedAt: string;
    /** Assembled AXIOM control prompt (controlLines + pianoGlobalLine + pianoSectionLines). */
    controlBlock: string;
    /** Conditioning text forwarded to the model. */
    conditioningText?: string;
    /** Full approved ABC score. */
    approvedAbc: string;
    /** Piano plan at the time of generation. */
    pianoPlan?: PianoPlan;
    /** Listener feedback if available. */
    listenerFeedback?: ListenerFeedback;
    /** Piano craft score at the time of approval. */
    pianoCraftScore?: PianoCraftScoreSummary;
}

/**
 * Rewrite training example: bad section + issue report → corrected section.
 *
 * Training signal: "given these issues and the original ABC, rewrite the flagged sections".
 * Populated by exportPianoRewriteDataset() from entries where rewriteApplied = true
 * and parentCandidateId is set.
 */
export interface PianoRewriteExample {
    kind: "piano_rewrite";
    entryId: string;
    songId: string;
    /** The rewritten (child) candidate. */
    candidateId: string;
    /** The parent (pre-rewrite) candidate. */
    parentCandidateId: string;
    capturedAt: string;
    /** Sections that were rewritten. */
    rewrittenSectionIds: string[];
    /** Overall reason for the rewrite. */
    reason: string;
    /** Directives that drove the rewrite. */
    directives: PianoRevisionDirective[];
    /** AXIOM_PIANO_REWRITE block text as sent to the model. */
    pianoRewriteBlock?: string;
    /** ABC text before rewrite (parent candidate). */
    beforeAbc?: string;
    /** ABC text after rewrite (this candidate). */
    afterAbc?: string;
    /** Piano evidence before rewrite (from parent entry). */
    beforeEvidence?: PianoDataLoopEvidence;
    /** Piano evidence after rewrite (from this entry). */
    afterEvidence?: PianoDataLoopEvidence;
    /** Whether the rewrite improved the piano craft score. */
    improved?: boolean;
    beforePianoScore?: number;
    afterPianoScore?: number;
}

/**
 * Preference pair example: same-prompt candidates, chosen vs rejected.
 *
 * Training signal: DPO-style "prefer A over B given this control prompt".
 * Populated by exportPianoPreferenceDataset() from candidates with the
 * same promptGroupKey and different approval/score outcomes.
 */
export interface PianoPreferenceExample {
    kind: "piano_preference";
    pairId: string;
    songId: string;
    capturedAt: string;
    controlBlock: string;
    pianoPlan?: PianoPlan;
    chosen: {
        entryId: string;
        candidateId: string;
        abc: string;
        pianoCraftScore?: PianoCraftScoreSummary;
        listenerFeedback?: ListenerFeedback;
    };
    rejected: {
        entryId: string;
        candidateId: string;
        abc: string;
        pianoCraftScore?: PianoCraftScoreSummary;
        listenerFeedback?: ListenerFeedback;
    };
    /** Reason the chosen was preferred over rejected. */
    choiceReason: "listener_approved" | "craft_score_higher" | "playability_gate";
}

/**
 * Playability label example: generated passage + playable/unplayable label.
 *
 * Training signal: "given this piano passage, is it physically playable?".
 * Populated by exportPianoPlayabilityDataset() from all entries with
 * pianoEvidence.playabilityScore present.
 */
export interface PianoPlayabilityExample {
    kind: "piano_playability";
    entryId: string;
    songId: string;
    candidateId: string;
    capturedAt: string;
    /** ABC text for this passage. */
    abc: string;
    /** Computed playability score (0–1). */
    playabilityScore: number;
    /** Binary label derived from playabilityScore >= PLAYABILITY_THRESHOLD. */
    label: "playable" | "unplayable";
    /** Key piano evidence dimensions used to compute the label. */
    evidence: PianoDataLoopEvidence;
    pianoCraftScore?: PianoCraftScoreSummary;
}
