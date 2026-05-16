# Learned Backbone Stage A S1 Supplemental Review Pack Refresh

- observed_at: 2026-04-19T09:11:20.069Z
- runtime_scope: local AXIOM workspace runtime
- lane: string_trio_symbolic
- benchmark_pack_version: string_trio_symbolic_benchmark_pack_v1
- source_commands:
  - npm.cmd run ml:review-pack:record:learned-backbone -- --resultsFile outputs/_system/ml/review-packs/learned-backbone/2026-04-19T07-03-13-934Z/review-sheet.csv
  - npm.cmd run ml:summarize:learned-backbone -- --outputDir outputs
  - npm.cmd run ml:review-pack:learned-backbone -- --pendingOnly
- completed_review_pack: outputs/_system/ml/review-packs/learned-backbone/2026-04-19T07-03-13-934Z
- supplemental_review_pack: outputs/_system/ml/review-packs/learned-backbone/2026-04-19T09-11-20-038Z
- verdict: DO_NOT_ADVANCE_PAST_STAGE_A

## Current Aggregate

| Metric | Value |
| --- | ---: |
| runCount | 18 |
| pairedRunCount | 18 |
| reviewedRunCount | 7 |
| pendingReviewCount | 11 |
| blindPreference.available | true |
| blindPreference.winRate | 0.1429 |
| blindPreference.reviewedPairCount | 16 |
| blindPreference.decisivePairCount | 14 |
| blindPreference.learnedWinCount | 2 |
| blindPreference.baselineWinCount | 12 |
| blindPreference.tieCount | 2 |
| reviewedTop1Accuracy.available | true |
| reviewedTop1Accuracy.selectedTop1Accuracy | 0.5000 |
| reviewedTop1Accuracy.correctSelectionCount | 7 / 14 decisive pairs |
| reviewQueue.pendingBlindReviewCount | 2 |
| reviewQueue.pendingShortlistReviewCount | 0 |
| reviewPacks.matchedPackCount | 3 |
| reviewPacks.activePackCount | 0 |
| reviewPacks.completedDecisionCount | 16 |
| reviewSampleStatus.status | directional_only |
| reviewSampleStatus.reviewedRunCount | 7 |
| reviewSampleStatus.reviewedDisagreementCount | 0 |
| promotionGate.status | experimental |
| promotionGate.signal | negative |
| promotionGate.blockers | reviewed_runs_below_floor, reviewed_disagreements_below_floor, shortlist_quality_below_floor, reviewed_outcomes_favor_baseline |

## Supplemental Pack Status

The previously pending 9-entry blind review worksheet has been ingested, and the remaining blind-review backlog now resolves to a new 2-entry supplemental pack.

1. new_pack_id: 2026-04-19T09-11-20-038Z
2. reviewTarget: all
3. entryCount: 2
4. pendingBlindReviewCount_at_generation: 2
5. pendingShortlistReviewCount_at_generation: 0

Supplemental worksheet rows:

1. counterline_dialogue_probe: outputs/_system/ml/review-packs/learned-backbone/2026-04-19T09-11-20-038Z/review-sheet.csv row `pair-001`
2. cadence_clarity_reference: outputs/_system/ml/review-packs/learned-backbone/2026-04-19T09-11-20-038Z/review-sheet.csv row `pair-002`

## Interpretation

1. Stage A remains the active lane. The new blind-review decisions improved coverage and changed the aggregate metrics materially relative to the earlier reviewed checkpoint, but they did not change the promotion verdict.
2. The learned backbone is still losing the most important comparative readout. Blind preference is now non-zero for learned, but baseline still leads decisively at 12 wins to 2 across 14 decisive pairs.
3. Reviewed manifest evidence has not moved. `reviewedRunCount` remains 7, which is still below the 20-run early-screening floor and far below the 30 reviewed / 10 disagreement promotion floor.
4. The next human input is now narrower and explicit: finish the 2-entry supplemental blind review pack. After that, the remaining blocker is not blind-pack creation but better learned quality and more discriminative reviewed manifest evidence.
5. This refresh does not justify Stage B search expansion or Stage C reranker authority. The official roadmap interpretation is still to hold on Stage A.

## Recommended Next Work

1. Complete the supplemental 2-entry blind review worksheet at outputs/_system/ml/review-packs/learned-backbone/2026-04-19T09-11-20-038Z/review-sheet.csv and ingest it.
2. Record additional manifest-level reviewed outcomes with appeal or strongest/weakest-dimension annotations so the approval evidence becomes discriminative rather than all-approved parity.
3. Only after those two items, decide whether a material backbone change has happened that justifies another refreshed Stage A reviewed checkpoint.