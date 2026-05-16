# Learned Backbone Stage A S1 Reviewed Checkpoint

- observed_at: 2026-04-19T05:54:03.812Z
- lane: string_trio_symbolic
- benchmark_pack_version: string_trio_symbolic_benchmark_pack_v1
- benchmark_ids: cadence_clarity_reference, counterline_dialogue_probe, localized_rewrite_probe
- source_command: npm run ml:summarize:learned-backbone -- --outputDir outputs
- manifest_review_sheet: outputs/_system/ml/review-manifests/learned-backbone/2026-04-19-stage-a-s1-manifest-r01/review-sheet.csv
- review_packs_completed: 2026-04-19-stage-a-s1-pack-r01, 2026-04-19-stage-a-s1-pack-r02
- verdict: DO_NOT_ADVANCE_PAST_STAGE_A

## Current Aggregate

| Metric | Value |
| --- | ---: |
| runCount | 7 |
| pairedRunCount | 7 |
| reviewedRunCount | 7 |
| pendingReviewCount | 0 |
| approvalRate | 1.00 |
| averageAppealScore | unavailable |
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
| reviewSampleStatus.status | directional_only |
| reviewSampleStatus.reviewedRunCount | 7 |
| reviewSampleStatus.reviewedDisagreementCount | 0 |
| reviewSampleStatus.minimumReviewedRunCountForScreening | 20 |
| reviewSampleStatus.minimumReviewedRunCountForPromotion | 30 |
| reviewSampleStatus.minimumReviewedDisagreementCountForPromotion | 10 |
| promotionGate.status | experimental |
| promotionGate.signal | negative |
| promotionAdvantage.signal | parity |
| promotionAdvantage.approvalRateDelta | 0.00 |
| retryLocalizationStability.status | not_enough_retry_data |
| disagreementSummary.disagreementRunCount | 0 |
| disagreementSummary.reviewedDisagreementCount | 0 |
| selectionModeCounts.learned_selected | 2 |
| selectionModeCounts.baseline_selected | 5 |
| searchBudgetCounts.S1 | 7 |

## Coverage Snapshot

| Benchmark | Runs | Reviewed | Approval Rate | Selected Worker Split |
| --- | ---: | ---: | ---: | --- |
| cadence_clarity_reference | 3 | 3 | 1.00 | learned 2, baseline 1 |
| localized_rewrite_probe | 3 | 3 | 1.00 | baseline 3 |
| counterline_dialogue_probe | 1 | 1 | 1.00 | baseline 1 |

## Interpretation

1. This checkpoint moves the Stage A sample from blind-review-only evidence to reviewed manifest evidence, but it still does not justify Stage B or Stage C expansion. All observed runs remain S1 whole-piece attempts and the total reviewed sample is still only 7.
2. Approval coverage is now complete for the current S1 pack, but the approval signal is non-discriminative. All 7 benchmark manifests were marked approved and no appeal scores were recorded, so approval rate is 1.00 for both learned-selected and baseline-selected cohorts.
3. The most important comparative readout still favors baseline. Across 6 decisive blind pair reviews, learned wins remain 0 and baseline wins remain 6.
4. Promotion advantage is now measurable at the cohort-size floor and currently reads `parity`, not learned advantage. The added reviewed evidence does not overturn the blind-review result.
5. `reviewedRunCount` improved from 0 to 7, but this is still below the 20-run early-screening floor and far below the 30 reviewed / 10 disagreement promotion floor. `reviewedDisagreementCount` remains 0.
6. `reviewedSelectedInShortlistRate` remains below floor, so the gate now names `shortlist_quality_below_floor` instead of `shortlist_quality_unavailable`. This is still a hold signal, not a promotion signal.

## Decision

1. Keep `music21` as the authoritative narrow-lane floor.
2. Keep the learned backbone `experimental`.
3. Do not widen to Stage B or Stage C on the basis of the current reviewed checkpoint.

## Recommended Next Work

1. Improve whole-piece learned backbone quality on cadence clarity and counterline dialogue before spending more review budget on larger search cells.
2. On the next reviewed sample, record appeal scores and strongest or weakest dimensions so approval evidence is discriminative rather than all-approved parity.
3. Do not spend time on Stage C reranker authority until real disagreement cases exist; the current disagreement count remains 0.
4. Re-run the fixed S1 checkpoint only after a material learned-backbone change, so the next comparison tests different model behavior instead of reaffirming the same baseline-favoring state.
