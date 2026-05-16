# Learned Backbone Post-Repair Smoke

- observed_at: 2026-04-19
- batch_id: 2026-04-19-current-state-counterline-postrepair-s1-r01
- lane: string_trio_symbolic
- search_budget: S1
- benchmark_ids: cadence_clarity_reference, counterline_dialogue_probe
- source_command: npm.cmd run ml:run:learned-backbone -- --batchId 2026-04-19-current-state-counterline-postrepair-s1-r01 --benchmarkIds cadence_clarity_reference,counterline_dialogue_probe --searchBudget S1 --repeat 1

## What Changed

This smoke batch was run after repairing the learned symbolic projection helper block and tightening the fallback backbone behavior around trio handoffs, rest-aware phrase pressure, contrary-motion support, and explicit cadential bass closure.

The regression target was unchanged from the reviewed Stage A hold: make the fixed learned fallback strong enough that the paired S1 smoke no longer loses the cadence or counterline probes for avoidable projection reasons.

## Result Snapshot

| Benchmark | Selected Worker | Learned Score | Learned Passed | Notes |
| --- | --- | ---: | ---: | --- |
| cadence_clarity_reference | learned_symbolic | 93.83 | true | cadence now passes; remaining weakness is phrase-pressure contrast |
| counterline_dialogue_probe | learned_symbolic | 85.14 | true | learned now beats the baseline selector on the fixed dialogue probe, though tonicization and handoff clarity still have room to improve |

## Metric Delta Versus Pre-Patch Baseline

### cadence_clarity_reference learned candidate

| Metric | Pre-patch smoke | Post-repair smoke |
| --- | ---: | ---: |
| structureEvaluation.score | 92.22 | 93.83 |
| passed | false | true |
| issueCount | 2 | 1 |
| phrasePressureFit | 0.2406 | 0.4414 |
| harmonicCadenceSupport | 0 | 1 |
| dominantPreparationStrength | 0.78 | 0.85 |
| globalHarmonicProgressionStrength | 0.78 | 0.85 |
| formCoherenceScore | 0.89 | 0.925 |
| weakSectionCount | 1 | 0 |
| sectionReliabilityFit | 0.8605 | 0.9085 |

Remaining learned issue:

1. Section phrase pressure still compresses some formal contrast.

### counterline_dialogue_probe learned candidate

| Metric | Pre-patch smoke | Post-repair smoke |
| --- | ---: | ---: |
| structureEvaluation.score | 82.49 | 85.14 |
| selected worker | music21 | learned_symbolic |
| passed | false | true |
| issueCount | 9 | 4 |
| phrasePressureFit | 0.3308 | 0.4975 |
| parallelPerfectCount | 2 | 1 |
| harmonicCadenceSupport | 0 | 1 |
| dominantPreparationStrength | 0 | 1 |
| globalHarmonicProgressionStrength | 0 | 1 |
| formCoherenceScore | 0.4583 | 0.9584 |
| tensionArcMismatch | 0.0533 | 0.0277 |
| sectionReliabilityFit | 0.7318 | 0.7711 |
| weakSectionCount | 1 | 0 |

Remaining learned issues:

1. Section phrase pressure still runs denser than the intended formal contrast.
2. Section tonicization pressure is still weak in one span.
3. Texture rotation is improved but not yet fully clear.
4. Section-to-section handoffs still need more explicit reassignment to become comfortably robust.

## Interpretation

1. The immediate Stage A engineering blocker is cleared on the fixed S1 smoke probes. The learned fallback now passes both targeted benchmarks and is selected on the counterline probe where it previously lost to `music21`.
2. This does not by itself justify promotion past Stage A. The latest reviewed checkpoint is still negative, and no new blind or reviewed evidence has yet replaced that checkpoint.
3. The next roadmap-valid task is to refresh Stage A reviewed evidence at S1 with the repaired backbone before spending more effort on Stage B search widening or Stage C reranker authority.