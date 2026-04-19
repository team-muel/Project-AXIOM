# Learned Backbone Stage A S1 Post-Repair Refresh

- observed_at: 2026-04-19
- batch_id: 2026-04-19-stage-a-s1-postrepair-full-pack-r01
- lane: string_trio_symbolic
- search_budget: S1
- benchmark_pack: string_trio_symbolic_benchmark_pack_v1
- source_commands:
  - npm.cmd run ml:run:learned-backbone -- --batchId 2026-04-19-stage-a-s1-postrepair-full-pack-r01 --searchBudget S1
  - npm.cmd run ml:summarize:learned-backbone -- --outputDir outputs
  - npm.cmd run ml:review-pack:learned-backbone -- --pendingOnly
- pending_review_pack: outputs/_system/ml/review-packs/learned-backbone/2026-04-19T07-03-13-934Z

## Result Snapshot

| Benchmark | Selected Worker | Approval Status |
| --- | --- | --- |
| cadence_clarity_reference | learned_symbolic | pending |
| counterline_dialogue_probe | learned_symbolic | pending |
| localized_rewrite_probe | learned_symbolic | pending |

Selected worker counts for this rerun:

1. learned_symbolic: 3
2. music21: 0

## Review Queue Status

The refreshed Stage A rerun has been pushed into a new pending review pack.

1. pendingBlindReviewCount: 9
2. pendingShortlistReviewCount: 0
3. entryCount: 9

## Interpretation

1. The repaired learned backbone is no longer losing the fixed S1 full-pack rerun at selection time. All three benchmark rows selected `learned_symbolic` in the paired lane.
2. This is still pre-review evidence. The official reviewed checkpoint remains the last completed human-reviewed state until the new pending pack is adjudicated.
3. The next required action is review completion, not more backbone surgery or Stage B search expansion.