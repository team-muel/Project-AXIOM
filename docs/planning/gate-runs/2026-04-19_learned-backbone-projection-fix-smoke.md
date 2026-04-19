# Learned Backbone Projection Fix Smoke

- observed_at: 2026-04-19
- batch_id: 2026-04-19-projection-fix-smoke-s1-duo-r01
- lane: string_trio_symbolic
- search_budget: S1
- benchmark_ids: cadence_clarity_reference, counterline_dialogue_probe
- source_command: npm.cmd run ml:run:learned-backbone -- --batchId 2026-04-19-projection-fix-smoke-s1-duo-r01 --benchmarkIds cadence_clarity_reference,counterline_dialogue_probe --searchBudget S1 --repeat 1

## What Changed

This smoke batch was run after the learned symbolic fallback projection was made orchestration-aware and rhythm-aware.
The patch specifically aimed to reduce fixed quarter-note pressure, add clearer cadential closure, and honor trio handoff expectations between support and conversational sections.

## Result Snapshot

| Benchmark | Selected Worker | Learned Score | Learned Passed | Rhythm Uniformity Issue | Notes |
| --- | --- | ---: | ---: | --- | --- |
| cadence_clarity_reference | learned_symbolic | 92.22 | false | cleared | cadence quality moved up sharply, but phrase pressure and cadential bass support still need work |
| counterline_dialogue_probe | music21 | 82.49 | false | cleared | handoff and rotation improved materially, but counterpoint and harmonic-role issues still keep learned behind baseline |

## Metric Delta Versus Pre-Fix Reference

### cadence_clarity_reference learned candidate

| Metric | Pre-fix | Smoke batch |
| --- | ---: | ---: |
| structureEvaluation.score | 83.19 | 92.22 |
| uniqueDurations | 1 | 4 |
| phrasePressureFit | 0.1111 | 0.2406 |
| parallelPerfectCount | 6 | 1 |

Remaining learned issues:

1. Cadential bass motion does not consistently support the planned tonal closes.
2. Section phrase pressure compresses the planned formal contrast.

### counterline_dialogue_probe learned candidate

| Metric | Pre-fix | Smoke batch |
| --- | ---: | ---: |
| structureEvaluation.score | 79.73 | 82.49 |
| uniqueDurations | 1 | 4 |
| phrasePressureFit | 0.2323 | 0.3308 |
| orchestrationTextureRotationFit | 0.3514 | 0.9408 |
| orchestrationSectionHandoffFit | 0.2778 | 0.5873 |

Remaining learned issues:

1. Parallel perfect intervals still weaken outer-voice motion.
2. Cadential bass support and dominant preparation remain inconsistent.
3. Counterpoint behavior is still too weak in the requested dialogue section.
4. Section-to-section handoff is better, but still not strong enough to beat baseline selection.

## Interpretation

1. The next work item was valid: projection fallback quality was a real blocker, and this patch improved the learned worker on the exact Stage A weak spots called out by the reviewed checkpoint.
2. The patch is not sufficient to clear Stage A. The cadence probe improved enough for learned to remain selected in the smoke batch, but the counterline probe still selected `music21`.
3. The improvement is real, not cosmetic. The removed rhythm-uniformity issue and the jump in counterline handoff or rotation metrics show that the projection now responds to orchestration plan changes instead of flattening them.
4. The next smallest improvement target should stay on counterline-specific independence and harmonic-role support, not Stage B search expansion.
