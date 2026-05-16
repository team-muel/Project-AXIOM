# Learned Backbone Stage A Pending Manifest Review Sheet Opened

- observed_at: 2026-04-19T09:29:59.834Z
- runtime_scope: local AXIOM workspace runtime
- lane: string_trio_symbolic
- benchmark_pack_version: string_trio_symbolic_benchmark_pack_v1
- source_commands:
  - npm.cmd run ml:manifest-review:learned-backbone -- --snapshot 2026-04-19-stage-a-post-supplemental-manifest-r02
  - node scripts/summarize-learned-backbone-benchmark.mjs --outputDir outputs
- manifest_review_sheet: outputs/_system/ml/review-manifests/learned-backbone/2026-04-19-stage-a-post-supplemental-manifest-r02/review-sheet.csv
- verdict: DO_NOT_ADVANCE_PAST_STAGE_A

## Current Aggregate

| Metric | Value |
| --- | ---: |
| runCount | 18 |
| pairedRunCount | 18 |
| reviewedRunCount | 7 |
| pendingReviewCount | 11 |
| blindPreference.available | true |
| blindPreference.winRate | 0.1250 |
| blindPreference.reviewedPairCount | 18 |
| blindPreference.decisivePairCount | 16 |
| blindPreference.learnedWinCount | 2 |
| blindPreference.baselineWinCount | 14 |
| blindPreference.tieCount | 2 |
| reviewedTop1Accuracy.available | true |
| reviewedTop1Accuracy.selectedTop1Accuracy | 0.4375 |
| reviewQueue.pendingBlindReviewCount | 0 |
| reviewQueue.pendingShortlistReviewCount | 0 |
| reviewSampleStatus.status | directional_only |
| reviewSampleStatus.reviewedRunCount | 7 |
| reviewSampleStatus.reviewedDisagreementCount | 0 |
| promotionGate.status | experimental |
| promotionGate.signal | negative |
| promotionGate.blockers | reviewed_runs_below_floor, reviewed_disagreements_below_floor, shortlist_quality_below_floor, reviewed_outcomes_favor_baseline |

## Pending Manifest Review Sheet Status

The next Stage A evidence task is now opened as a pending manifest review sheet for the currently unreviewed runs.

1. snapshot: 2026-04-19-stage-a-post-supplemental-manifest-r02
2. rowCount: 11
3. benchmarkIds: cadence_clarity_reference, counterline_dialogue_probe, localized_rewrite_probe
4. dominant selection mode in pending rows: learned_selected
5. required annotation fields: approvalStatus, appealScore, strongestDimension, weakestDimension, comparisonReference, note

## Interpretation

1. Stage A remains active and blocked. The blind-review queue is clear, so the current bottleneck has shifted fully to manifest review evidence.
2. The newly generated sheet opens the exact 11 pending runs that must be reviewed to move beyond the current `reviewedRunCount` of 7.
3. Because blind preference remains strongly baseline-favoring and reviewed disagreement count is still 0, simply clearing this sheet is not enough by itself to declare the backbone complete.
4. The review annotations matter as much as the approval decision. Without appeal or strongest/weakest-dimension detail, the approval evidence stays non-discriminative.

## Recommended Next Work

1. Fill the 11 pending manifest rows in outputs/_system/ml/review-manifests/learned-backbone/2026-04-19-stage-a-post-supplemental-manifest-r02/review-sheet.csv with approval and discriminative annotations.
2. Record that sheet with `npm.cmd run ml:manifest-review:record:learned-backbone -- --resultsFile <sheet>`.
3. Re-run the learned-backbone summary after ingest and reassess whether the reviewed sample has become informative enough for a refreshed Stage A reviewed checkpoint.