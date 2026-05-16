# Learned Backbone Stage A S1 Checkpoint

- generated_at: 2026-04-19T05:08:10.807Z
- lane: string_trio_symbolic
- benchmark_pack_version: string_trio_symbolic_benchmark_pack_v1
- benchmark_ids: cadence_clarity_reference, counterline_dialogue_probe, localized_rewrite_probe
- source_command: npm run ml:summarize:learned-backbone -- --outputDir outputs
- review_packs_completed: 2026-04-19-stage-a-s1-pack-r01, 2026-04-19-stage-a-s1-pack-r02
- verdict: DO_NOT_ADVANCE_PAST_STAGE_A

## Current Aggregate

| Metric | Value |
| --- | ---: |
| runCount | 7 |
| pairedRunCount | 7 |
| reviewedRunCount | 0 |
| pendingReviewCount | 7 |
| blindPreference.available | true |
| blindPreference.winRate | 0.00 |
| blindPreference.reviewedPairCount | 7 |
| blindPreference.decisivePairCount | 6 |
| blindPreference.learnedWinCount | 0 |
| blindPreference.baselineWinCount | 6 |
| blindPreference.tieCount | 1 |
| reviewedTop1Accuracy.available | true |
| reviewedTop1Accuracy.selectedTop1Accuracy | 0.6667 |
| reviewedTop1Accuracy.correctSelectionCount | 4 / 6 decisive pairs |
| reviewQueue.pendingBlindReviewCount | 0 |
| reviewQueue.pendingShortlistReviewCount | 0 |
| reviewPacks.activePackCount | 0 |
| reviewPacks.completedDecisionCount | 7 |
| reviewSampleStatus.status | directional_only |
| reviewSampleStatus.remainingReviewedRunCountForScreening | 20 |
| reviewSampleStatus.remainingReviewedRunCountForPromotion | 30 |
| reviewSampleStatus.remainingReviewedDisagreementCountForPromotion | 10 |
| promotionGate.status | experimental |
| promotionGate.signal | negative |
| retryLocalizationStability.status | not_enough_retry_data |
| disagreementSummary.disagreementRunCount | 0 |
| disagreementSummary.reviewedDisagreementCount | 0 |
| selectionModeCounts.learned_selected | 2 |
| selectionModeCounts.baseline_selected | 5 |
| searchBudgetCounts.S1 | 7 |

## Coverage Snapshot

| Benchmark | Runs | Selected Worker Split | Directional Read |
| --- | ---: | --- | --- |
| cadence_clarity_reference | 3 | learned 2, baseline 1 | blind review favored baseline overall |
| localized_rewrite_probe | 3 | baseline 3 | no learned advantage observed |
| counterline_dialogue_probe | 1 | baseline 1 | baseline selected and blind review favored baseline |

## Interpretation

1. This checkpoint is still Stage A evidence only. All observed runs are S1 and all selected benchmark generations are plan-conditioned whole-piece attempts, so this is not evidence to advance Stage B search-budget widening or Stage C reranker authority.
2. The current whole-piece learned backbone does not beat the `music21` baseline on the most important Stage A directional readout. Across 6 decisive blind pair reviews, learned wins are 0 and baseline wins are 6.
3. The selected top-1 decision rule is only partially aligned with blind review. Runtime selected the blind-review winner on 4 of 6 decisive pairs, and both learned-selected decisive pairs lost to baseline in blind review.
4. `reviewedRunCount` remains 0 because blind review pack results feed `blindPreference` and `reviewedTop1Accuracy`, but they do not by themselves create manifest-level approval or appeal outcomes. Approval-rate and appeal-score gates are still unpopulated.
5. `disagreementSummary` remains 0, so there is no present evidence basis for C2 through C4 reranker comparisons.
6. `retryLocalizationStability` remains `not_enough_retry_data`, so this checkpoint should not be read as an A4 localized-rewrite pass. The current pack provides directional whole-piece S1 evidence, not guarded localized-branch evidence.

## Decision

1. Keep `music21` as the authoritative narrow-lane floor.
2. Keep the learned backbone `experimental`.
3. Do not widen to Stage B or Stage C on the basis of the current checkpoint.

## Recommended Next Work

1. Improve whole-piece learned backbone quality on cadence clarity and counterline dialogue before spending more review budget on larger search cells.
2. If approval-rate or appeal-score evidence is needed for the gate, record manifest-level reviewed outcomes (`approvalStatus` and `reviewFeedback`) in addition to blind pair results.
3. Re-run the fixed S1 checkpoint only after a material learned-backbone change, so the next comparison is testing a different model behavior rather than re-sampling the same quality level.
