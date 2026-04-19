# AXIOM Truth-Plane Dataset Design

## Goal

AXIOM already persists enough truth-plane evidence to stop training only from prompt text and final outcomes.
This document defines how to turn the current persisted manifest and candidate sidecars into versioned datasets for three learning problems:

1. learned symbolic backbone training or fine-tuning
2. localized rewrite training
3. candidate reranking and search-policy training

This document covers internal AXIOM truth-plane data only.
It does not replace the separate public-domain corpus needed for broad symbolic pretraining.
External backbone candidates and their AXIOM roles are summarized in [symbolic-backbone-reference.md](symbolic-backbone-reference.md).

## Scope

In scope:

1. `outputs/<songId>/manifest.json`
2. `outputs/<songId>/section-artifacts.json`
3. `outputs/<songId>/expression-plan.json`
4. `outputs/<songId>/candidates/index.json`
5. `outputs/<songId>/candidates/<candidateId>/candidate-manifest.json`
6. `outputs/<songId>/candidates/<candidateId>/section-artifacts.json`
7. `outputs/<songId>/candidates/<candidateId>/composition.mid`
8. `outputs/<songId>/candidates/<candidateId>/reranker-score.json`
9. `outputs/_system/operator-actions/latest.json` and `history/YYYY-MM-DD.jsonl`
10. `outputs/_system/ml/runtime/structure-rank-v1-shadow-history/YYYY-MM-DD.jsonl`

Out of scope:

1. direct scraping or packaging of external public-domain corpora
2. new runtime-only ephemeral state that is not already persisted in the truth plane
3. audio-only prompt logs without corresponding symbolic or candidate evidence

## Design Principles

1. Truth-plane first: training rows must be reconstructable from persisted files only.
2. Provenance always visible: every row carries its source artifact paths and review tier.
3. Group integrity over row count: candidate groups and retry families stay together across splits.
4. Review beats heuristics: human approval and pairwise preference outrank heuristic scores when both exist.
5. Selected output is not enough: near-miss candidates and rejected retries must remain in the dataset.

## Canonical Entities

### Piece

Primary key:

- `songId`

Represents one end-to-end pipeline run and its selected final manifest.

### Candidate Group

Primary key:

- `songId`
- `attempt`

Represents all comparable candidate snapshots produced for one structure-attempt round.

### Candidate

Primary key:

- `songId`
- `candidateId`

Represents one concrete symbolic candidate with its own compact manifest, artifacts, proposal evidence, and optional reranker evidence.

### Rewrite Unit

Primary key:

- `songId`
- `candidateId`
- `sectionId`

Represents one localized retry example where a weak section was regenerated under explicit `revisionDirectives` and prior section-artifact context.

### Review Event

Primary key:

- `songId`
- `observedAt`
- `action`

Represents one operator approval or rejection event linked to the resulting manifest and candidate group.

## Source Precedence

When the same concept appears in multiple persisted places, exporters should read in this order:

1. candidate-local sidecar
2. selected manifest sidecar
3. top-level manifest fallback
4. operator-action audit artifact

Examples:

1. targeted rewrite context should prefer candidate `sectionTransforms[]` and candidate `section-artifacts.json` over top-level `manifest.sectionTransforms`
2. review labels should prefer manifest `reviewFeedback` plus operator-action audit records over derived dashboard summaries
3. reranker promotion labels should prefer candidate `rerankerPromotion` over operator summary aggregates

## Dataset Products

### 1. `axiom_backbone_piece_v1`

Purpose:

Train or fine-tune a learned symbolic backbone to consume AXIOM planning contracts and produce a full narrow-lane piece.

Row unit:

- one selected piece row per `songId`

Required sources:

1. `manifest.json`
2. selected candidate `composition.mid` when candidate sidecars exist, otherwise root `artifacts.midi`
3. selected `section-artifacts.json`
4. `expression-plan.json` when present

Conditioning fields:

1. prompt
2. workflow
3. `CompositionPlan`
4. section boundaries and section IDs
5. phrase or texture or harmony or expression defaults
6. selected model bindings
7. revision lineage summary when the selected output is itself a retry

Target fields:

1. normalized symbolic event sequence derived from the selected MIDI
2. section-aligned control markers from `section-artifacts.json`
3. optional role tags recovered from accompaniment or secondary-line evidence

Quality labels:

1. `approvalStatus`
2. `reviewFeedback.appealScore`
3. structure and audio scores
4. `longSpan.status`
5. retry count and stop reason

Eligibility tiers:

1. Tier A: human-reviewed approved rows
2. Tier B: human-reviewed rejected rows kept as contrastive negatives or repair curriculum inputs
3. Tier C: unreviewed but structure-passing rows, used only for auxiliary fine-tuning or teacher-distillation

### 2. `axiom_localized_rewrite_v1`

Purpose:

Train a model that changes one weak section while preserving untouched sections.

Row unit:

- one rewrite row per targeted `sectionId`

Required sources:

1. candidate `candidate-manifest.json`
2. candidate `section-artifacts.json`
3. parent selected or prior-attempt `section-artifacts.json`
4. candidate `composition.mid`

Inputs:

1. original section summary from the parent attempt
2. targeted `revisionDirectives`
3. prior section artifacts for untouched context
4. section-local harmonic, phrase, texture, and expression guidance

Targets:

1. rewritten section event sequence
2. rewritten section artifact summary
3. transform label such as `targeted_rewrite:clarify_phrase_rhetoric`

Key labels:

1. input directive kinds
2. input directive section IDs
3. retry localization type
4. whether untouched sections remained stable
5. whether the rewritten candidate was eventually selected

Eligibility rules:

1. include only rows with explicit targeted section context
2. exclude whole-piece drift retries from the positive localized-rewrite pool
3. keep rejected localized rewrites as hard negatives when the untouched sections destabilized

### 3. `axiom_search_reranker_v1`

Purpose:

Train and evaluate selection policies over candidate groups.

Row units:

1. group rows: one row per `songId` plus `attempt`
2. pairwise rows: one row per ordered winner or loser pair within a candidate group
3. shortlist rows: one row per reviewed top-k group for future listwise training

Required sources:

1. `candidates/index.json`
2. all candidate manifests for the group
3. all candidate section-artifact sidecars for the group
4. optional `reranker-score.json`
5. manifest review metadata and operator-action audit rows

Labels:

1. heuristic winner
2. selected winner
3. reviewed winner when a human preference or approval signal exists
4. promotion flag and promotion reason
5. appeal-weighted or approval-weighted outcome label

Feature families:

1. proposal evidence
2. structure metrics
3. long-span summary
4. retry lineage and localization
5. targeted rewrite transform context
6. review signals
7. optional runtime shadow disagreement evidence

Current relationship:

`structure_rank_v1` becomes one slice of this product, not the entire product.

## Packaging

Each dataset product should be exported as a versioned snapshot under `outputs/_system/ml/datasets/`.

Recommended layout:

```text
outputs/_system/ml/datasets/
  axiom_backbone_piece_v1/<snapshot>/
  axiom_localized_rewrite_v1/<snapshot>/
  axiom_search_reranker_v1/<snapshot>/
```

Each snapshot should contain:

1. `manifest.json` with exporter version, lane, review tier counts, split counts, and source date range
2. `rows.jsonl` or sharded `rows-*.jsonl` for metadata rows
3. `artifacts/` directory for copied or linked MIDI and optional compact section-target payloads
4. `splits.json` with train or validation or test membership by stable keys

## Split Rules

The main leakage risk is not only duplicate prompts.
It is shared plan, candidate-group, and retry-family structure.

Mandatory rules:

1. All rows from the same `songId` stay in the same split.
2. All candidate rows from the same candidate group stay in the same split.
3. All localized rewrites derived from the same parent attempt stay in the same split.
4. `promptHash` or `planSignature` collisions must never span train and evaluation splits.
5. If blind human review packs are created, their paired candidates must remain together and isolated from training.

Recommended narrow-lane split:

1. train: 70 percent
2. validation: 15 percent
3. test: 15 percent

But if reviewed sample volume is still sparse, prefer time-based holdout plus lane-family holdout over purely random splitting.

## Review Tiers

Each row must carry one review tier.

1. `reviewed_approved`: explicit approval and optional appeal or note
2. `reviewed_rejected`: explicit rejection and optional comparison reference or weakest dimension
3. `reviewed_pending`: human looked at it but no final decision yet
4. `runtime_selected_unreviewed`: system-selected winner without human review
5. `candidate_unselected`: non-winning candidate preserved for search learning

The exporter must never collapse these tiers into a single boolean quality label.

## Minimal Row Schema

Every exported row should include at least:

1. dataset product name and version
2. `songId`
3. lane and workflow
4. stable row key
5. source artifact paths
6. review tier
7. plan signature or prompt hash when present
8. split name
9. provenance timestamps

## Promotion Gates For Dataset Use

### Backbone fine-tuning gate

Allowed inputs:

1. reviewed approved rows
2. reviewed rejected rows only when used for contrastive or repair objectives
3. unreviewed rows only as auxiliary teacher data with lower weight

### Rewrite fine-tuning gate

Allowed inputs:

1. explicit targeted-rewrite rows
2. rows with stable untouched-section evidence

Not allowed:

1. retries that rewrote the entire piece
2. rows without reliable parent-attempt context

### Reranker training gate

Allowed inputs:

1. candidate groups with at least two comparable candidates
2. reviewed groups weighted above unreviewed groups
3. runtime shadow history only as auxiliary disagreement evidence, not as the winner label itself

## Immediate Implementation Sequence

1. keep the existing `ml:export:structure-rank` path as the seed exporter for reranker rows
2. add a piece-level exporter for selected narrow-lane outputs
3. add a rewrite exporter for targeted section rewrites with parent context
4. add one snapshot manifest summarizer that reports tier counts, promotion counts, and split leakage checks

## Current Implementation Status

1. `npm run ml:export:structure-rank` remains the comprehensive snapshot export path: it writes `structure_rank_v1` and also materializes the linked `axiom_backbone_piece_v1`, `axiom_localized_rewrite_v1`, and `axiom_search_reranker_v1` dataset roots for the same snapshot.
2. `npm run ml:export:backbone-piece` and `npm run ml:export:localized-rewrite` now expose the flat selected-piece and targeted-rewrite products as dedicated entrypoints when those datasets are needed directly. Their `splits.json` partitions now keep shared `promptHash` families together first, then fall back to `proposalPlanSignature`, then `songId`, so the flat exports can pass the snapshot leakage audit without reopening transient runtime state.
3. `npm run ml:summarize:truth-plane -- --snapshot <snapshot>` provides the step-4 snapshot audit surface: it reads dataset manifests plus split files and reports dataset counts, review tiers, promotion counts, and split leakage checks across `structure_rank_v1`, `axiom_backbone_piece_v1`, `axiom_localized_rewrite_v1`, and `axiom_search_reranker_v1` when those snapshot directories exist.
4. `npm run ml:review-pack:learned-backbone -- --snapshot <pack>` now scaffolds blinded benchmark pair packs under `outputs/_system/ml/review-packs/learned-backbone/` and also writes a `review-sheet.csv` worksheet beside `pack.json`. `npm run ml:review-pack:record:learned-backbone -- --snapshot <pack> --entryId <entry> --winnerLabel A|B|TIE|SKIP` records one blind-review decision back into that pack's `results.json`, while `npm run ml:review-pack:record:learned-backbone -- --snapshot <pack> --resultsFile review-sheet.csv` bulk-ingests all filled worksheet rows in one pass. `npm run ml:summarize:learned-backbone` then consumes completed `results.json` files there to report blind preference win rate once pairwise review decisions are filled in.

## Success Condition

This dataset program is successful when AXIOM can answer three questions from persisted files alone:

1. what plan and evidence produced the selected piece
2. what alternative candidates lost and why
3. what human or learned signals should change the next generator, rewrite model, or reranker
