# Backbone, Search Budget, And Reranker Matrix

## Goal

AXIOM should not decide the next generation architecture by intuition.
It should compare three levers under one fixed evaluation harness:

1. backbone quality
2. search budget
3. reranker policy

The comparison lane for this matrix is the current narrow canonical lane, not `audio_only`.

## Fixed Harness

Every experiment cell below should hold the following constant unless the cell explicitly changes it.

1. lane family: `string_trio_symbolic`
2. workflow: `symbolic_only` first, then confirm on `symbolic_plus_audio`
3. prompt pack: fixed benchmark pack with stable `planSignature` coverage
4. review rubric: same approval and appeal rubric across all cells
5. render path: same SoundFont and render stack
6. evaluator stack: same structure and audio evaluation logic

Representative external candidates for each backbone family are tracked in [symbolic-backbone-reference.md](symbolic-backbone-reference.md). The matrix below compares AXIOM integration roles, not brand names.

## Primary Metrics

Use these metrics in order.

1. human blind preference win rate
2. approval rate
3. average appeal score
4. reviewed top-1 accuracy on candidate groups
5. retry localization stability
6. long-span survival rate when long-span plans are present

Do not use raw heuristic structure score as the sole promotion metric.

## Factor Levels

### Backbone Levels

1. `B0`: `music21` only
2. `B1`: paired baseline plus narrow learned proposer, heuristic winner remains authoritative
3. `B2`: paired baseline plus learned whole-piece generator, heuristic winner remains authoritative
4. `B3`: paired baseline plus learned whole-piece generator plus localized rewrite capability

Representative mappings:

1. `B0`: current `music21` baseline and theory-engine reference
2. `B2`: a NotaGen-class conditional symbolic generator is the most direct current candidate for this level
3. `B3`: a NotaGen-class backbone plus DeepBach-style partial-regeneration or constrained resampling ideas is the most direct current design pattern
4. Aria-class models are better treated as piano continuation or variation references than as the first narrow-lane whole-piece backbone for `string_trio_symbolic`

### Search Budget Levels

1. `S0`: single selected candidate only
2. `S1`: paired baseline vs learned minimum budget
3. `S2`: four whole-piece candidates per request
4. `S3`: eight whole-piece candidates per request
5. `S4`: four whole-piece candidates plus localized rewrite branches on the top two weak sections

### Reranker Levels

1. `R0`: heuristic selection only
2. `R1`: static `structure_rank_v1` shadow only, no authoritative control
3. `R2`: feedback-aware reranker used for shortlist ordering, human still chooses the final winner
4. `R3`: feedback-aware reranker authoritative within a guarded narrow lane, human reviews only the top shortlist

## Recommended Experiment Sequence

Do not run the full Cartesian product immediately.
Use the staged sequence below so failures are interpretable.

## Operator Execution Surface

Use the fixed benchmark pack runner to materialize real narrow-lane benchmark evidence before generating blind review packs.

1. `npm run ml:run:learned-backbone -- --batchId=stage-a-s1 --searchBudget=S1`
2. `npm run ml:summarize:learned-backbone -- --outputDir outputs`
3. `npm run ml:review-pack:learned-backbone -- --pendingOnly`
4. `npm run ml:review-pack:record:learned-backbone -- --resultsFile outputs/_system/ml/review-packs/learned-backbone/<snapshot>/review-sheet.csv`

The runner writes batch metadata under `outputs/_system/ml/benchmark-runs/learned-backbone/<batchId>/manifest.json`, stamps generated manifests with the fixed review rubric version, and marks new benchmark runs as pending review by default so they enter the same Stage A/B/C evidence loop immediately.

## Stage A: Backbone Comparison

| ID | Backbone | Search | Reranker | Hypothesis | Primary Readout | Promotion Gate |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| A1 | B0 | S0 | R0 | Current baseline reference | approval rate, appeal score | establishes floor only |
| A2 | B1 | S1 | R0 | proposal evidence alone improves candidate pool quality | reviewed top-1 accuracy | learned proposals must beat A1 on reviewed groups |
| A3 | B2 | S1 | R0 | whole-piece learned generation beats proposal-only learned mode | blind preference, approval rate | learned whole-piece generator must exceed A2 before larger search budget |
| A4 | B3 | S1 | R0 | localized rewrite improves weak sections without destabilizing strong sections | retry localization stability, weakest-section lift | localized rewrite must stay local and improve weakest-section metrics |

Interpretation:

1. If A3 fails, do not spend more budget on reranker authority yet.
2. If A4 fails, keep rewrite experimental and do not include it in larger search cells.

## Stage B: Search Budget Comparison

Run Stage B with the best backbone level from Stage A.

| ID | Backbone | Search | Reranker | Hypothesis | Primary Readout | Stop Rule |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| B1 | winner of Stage A | S1 | R0 | paired minimum budget reference | blind preference, approval rate | baseline for search lift |
| B2 | winner of Stage A | S2 | R0 | four whole-piece candidates improve top-1 selection quality | reviewed top-1 accuracy | stop if review load rises without top-1 lift |
| B3 | winner of Stage A | S3 | R0 | eight whole-piece candidates add lift beyond four | blind preference, operator load | stop if marginal gain is below review cost |
| B4 | winner of Stage A | S4 | R0 | localized branching on top weak sections beats more whole-piece sampling | weakest-section lift, retry localization stability | stop if branching causes whole-piece drift or review overload |

Interpretation:

1. Search budget wins only if the selected top candidate improves, not if the average candidate improves.
2. Review time and operator load are part of the cost function.

## Stage C: Reranker Comparison

Run Stage C with the chosen backbone and chosen search budget from Stages A and B.

| ID | Backbone | Search | Reranker | Hypothesis | Primary Readout | Promotion Gate |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| C1 | chosen | chosen | R0 | heuristic-only reference | approval rate, appeal score | reference cell |
| C2 | chosen | chosen | R1 | static shadow model exposes informative disagreement but should not yet control selection | reviewed disagreement accuracy | disagreement must be useful before shortlist control |
| C3 | chosen | chosen | R2 | feedback-aware reranker improves shortlist quality | blind preference among shortlist winners | shortlist quality must beat C1 and C2 |
| C4 | chosen | chosen | R3 | guarded authoritative reranker improves selected winner quality | approval rate, appeal score, blind preference | only allow if reviewed sample floor is satisfied |

Guarded authoritative floor:

1. at least 30 reviewed candidate groups in the narrow lane
2. at least 10 reviewed groups where heuristic and learned preferences disagree
3. no regression in retry localization stability

## Stage D: End-To-End Confirmation

Once one cell wins Stages A through C, confirm it end to end.

| ID | Lane | Workflow | Winning Configuration | Goal | Required Evidence |
| ---- | ---- | ---- | ---- | ---- | ---- |
| D1 | narrow lane | symbolic_only | winner of A through C | prove symbolic quality lift without audio confounds | blind preference, approval, appeal, retry localization |
| D2 | narrow lane | symbolic_plus_audio | same configuration | prove the lift survives audio evaluation and render path | D1 metrics plus audio pass stability |
| D3 | longer narrow form | symbolic_only | same configuration | prove the gain is not only miniature-specific | long-span survival and reviewed top-1 accuracy |

Do not run D3 until D1 and D2 are stable.

## Minimal Sample Guidance

For each cell:

1. offline candidate-group evaluation: at least 100 groups when available
2. human reviewed end-to-end runs: at least 20 reviewed pieces for early screening
3. promotion decisions: at least 30 reviewed pieces and at least 10 disagreement cases

If sample size stays below these thresholds, mark the result as directional only.

## Decision Rules

### Promote A Backbone Level When

1. it beats the previous backbone on blind preference or approval rate
2. it does not reduce retry localization stability
3. failures still roll back cleanly to `music21`

### Promote A Search Budget When

1. selected top-1 quality rises materially
2. operator review cost remains acceptable
3. candidate evidence stays audit-friendly and grouped correctly

### Promote A Reranker Level When

1. shortlist or authoritative selection beats heuristic-only selection on reviewed evidence
2. disagreement confidence is calibrated enough for guardrailed use
3. sparse reviewed evidence is explicitly labeled as insufficient instead of treated as a win

## What To Record For Every Cell

1. config snapshot
2. prompt pack version
3. review rubric version
4. reviewed sample count
5. disagreement count
6. approval rate
7. average appeal score
8. blind preference win rate when available
9. retry localization stability
10. top failure modes and rollback notes

## Recommended First Pass

If execution budget is tight, start with these six cells only:

1. A1
2. A3
3. A4
4. B2
5. B4
6. C3

That reduced matrix is enough to answer the three main questions:

1. does a real learned whole-piece generator beat proposal-only learned mode
2. does search budget beat single-sample generation
3. does feedback-aware reranking improve shortlist quality enough to matter
