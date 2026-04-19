# DeepBach-Style Localized Rewrite Design

## Goal

This document describes how AXIOM should turn its current targeted retry mechanism into a stronger localized rewrite path inspired by DeepBach-style constrained regeneration.
The design goal is not to imitate Bach chorales.
The goal is to regenerate one weak region under explicit constraints while preserving surrounding strong material.

## Scope

In scope:

1. `revisionDirectives` targeting from [src/pipeline/quality.ts](src/pipeline/quality.ts)
2. retry orchestration in [src/pipeline/orchestrator.ts](src/pipeline/orchestrator.ts)
3. learned symbolic worker behavior in [workers/composer/compose_learned_symbolic.py](workers/composer/compose_learned_symbolic.py)
4. candidate sidecar persistence for rewrite evidence in [src/memory/candidates.ts](src/memory/candidates.ts)
5. reranker and dataset visibility for localized rewrite results

Out of scope:

1. making all retries learned-only
2. replacing the current structure critique or directive builder
3. creating a new public compose worker name

## Current Code Anchors

AXIOM already contains the basic skeleton for localized rewrite.

1. [src/pipeline/quality.ts](src/pipeline/quality.ts) already builds section-targeted `revisionDirectives` and rewrites the next request through `applyRevisionDirectives(...)`.
2. [src/pipeline/orchestrator.ts](src/pipeline/orchestrator.ts) already carries `revisionDirectives`, `sectionArtifacts`, and `attemptIndex` into future retries.
3. [workers/composer/compose_learned_symbolic.py](workers/composer/compose_learned_symbolic.py) already groups directive kinds into narrative, cadential, and texture rewrite families and can reuse untouched section artifacts.
4. [src/memory/candidates.ts](src/memory/candidates.ts) already persists `revisionDirectives`, `proposalEvidence`, and `sectionTransforms` into candidate sidecars.

The missing step is to make rewrite control more explicit, more local, and more measurable.

## Design Principles

1. Rewrite one weak region, not the whole piece.
2. Preserve untouched sections unless a directive explicitly expands the rewrite window.
3. Keep rewrite input context reconstructable from persisted sidecars.
4. Preserve operator-auditable evidence about what changed and why.
5. Let reranker and human review compare localized repairs against baseline retries on the same parent attempt.

## Conceptual Model

DeepBach matters here because it treats regeneration as constrained resampling inside a chosen window rather than as unconditional generation from scratch.
AXIOM should adopt that idea at the section level.

The AXIOM rewrite unit becomes:

1. parent candidate or parent attempt
2. one or two targeted weak sections
3. immutable surrounding context
4. explicit directive kinds and target sections
5. one rewrite branch that must prove it improved the weak span without destabilizing the rest

## Rewrite Unit Definition

Primary key:

1. `songId`
2. `attempt`
3. `candidateId`
4. `targetSectionIds[]`

Each rewrite unit should answer four questions:

1. what was weak
2. what context was frozen
3. what got regenerated
4. whether the rewrite improved the weak region while preserving the rest

## Windowing Policy

The first implementation should remain section-aligned, not measure-fragment aligned.

### Default rewrite window

1. use `directive.sectionIds[]` when present
2. if multiple directives target adjacent sections, merge them into one contiguous window
3. if no section target exists, do not treat the retry as a localized rewrite example

### Context windows

For each rewrite target, carry:

1. previous section summary when present
2. target section summary
3. next section summary when present

The surrounding sections are context, not rewrite targets, unless the merged window explicitly includes them.

## Input Contract To The Worker

The learned worker should continue to use the same public entrypoint, but the internal rewrite payload should become richer.

### Required rewrite payload fields

1. `revisionDirectives`
2. parent `sectionArtifacts`
3. normalized `CompositionPlan`
4. `attemptIndex`
5. stable `songId` and `candidateId`

### Recommended internal rewrite pack

1. `targetSectionIds`
2. `targetWindowStartSectionId`
3. `targetWindowEndSectionId`
4. `directiveKinds`
5. `frozenSectionIds`
6. `parentSectionArtifacts`
7. `parentSectionTransforms`

This is still derived from current truth-plane data, not new ephemeral state.

## Rewrite Modes

The first rewrite design should support only a few explicit modes.

### Mode 1: narrative rewrite

Triggered by:

1. `clarify_narrative_arc`
2. `clarify_phrase_rhetoric`
3. `expand_register`
4. `increase_pitch_variety`

Expected behavior:

1. rewrite target section melodic contour and local phrase pressure
2. keep neighboring harmonic identity stable unless harmony directives are also present

### Mode 2: cadential rewrite

Triggered by:

1. `strengthen_cadence`
2. `rebalance_recap_release`
3. `stabilize_harmony`

Expected behavior:

1. rewrite cadence approach, bass support, and local resolution strength
2. preserve unrelated opening and middle material

### Mode 3: texture rewrite

Triggered by:

1. `clarify_texture_plan`
2. `increase_rhythm_variety`

Expected behavior:

1. increase secondary-line independence or counterline clarity in the target section
2. avoid collapsing the role layout of untouched sections

## Worker Behavior

The current [workers/composer/compose_learned_symbolic.py](workers/composer/compose_learned_symbolic.py) already shows the right overall pattern.
The stronger design should evolve it in place rather than create a new public worker.

### Internal flow

1. read parent `sectionArtifacts`
2. identify target and frozen sections from `revisionDirectives`
3. reconstruct immutable context for frozen sections
4. regenerate only target sections with directive-specific bias
5. reassemble the piece
6. emit section-level transform metadata

### Preservation rule

Untouched sections should be copied or replayed from prior artifacts whenever possible.
They should not be regenerated unless the directive window explicitly expands.

## Truth-Plane Additions

The current truth-plane is close, but the rewrite path should preserve a few more explicit fields.

### Candidate-manifest additions

Recommended optional fields:

1. `rewriteContext.targetSectionIds`
2. `rewriteContext.frozenSectionIds`
3. `rewriteContext.parentCandidateId`
4. `rewriteContext.parentAttempt`

These belong in candidate sidecars, not the top-level manifest.

### Section transform additions

Current `transformMode=targeted_rewrite:<directive>` should remain the main compact signal.
Recommended optional companions:

1. `sourceAttempt`
2. `sourceSectionId`
3. `rewriteWindowSize`
4. `preservedNeighborCount`

### Why these additions matter

They let AXIOM answer later:

1. whether the retry was truly local
2. which parent attempt it came from
3. whether the weak span improved without collateral damage

## Selection And Reranking

Localized rewrite should not bypass the shared selection path.

### Candidate comparison rules

1. rewritten candidates compete with baseline retries from the same parent attempt
2. heuristic critique still screens catastrophic failures first
3. reranker can use rewrite-local features such as target section count, directive kind, and preserved neighbor count

### New feature candidates for reranking

1. `rewriteWindowSize`
2. `rewriteTargetSectionCount`
3. `preservedNeighborCount`
4. `rewriteDirectiveFamily:narrative|cadential|texture`
5. `rewriteSelectedAfterRetry`

These should remain optional additions to the existing feature map in [src/pipeline/structureShadowReranker.ts](src/pipeline/structureShadowReranker.ts).

## Dataset Impact

This design directly feeds [truth-plane-dataset-design.md](truth-plane-dataset-design.md).

### Positive rewrite rows

Include when:

1. target section IDs are explicit
2. frozen sections remain stable enough
3. weakest-section metrics improve or the rewritten candidate is selected

### Negative rewrite rows

Include when:

1. target rewrite destabilizes untouched sections
2. weakest-section score does not improve
3. rewrite loses against a paired baseline retry

## File-Level Change Plan

### Phase A: explicit rewrite context packing

1. enrich the learned worker payload builder in [src/composer/index.ts](src/composer/index.ts)
2. pack explicit target or frozen section IDs for internal worker use

### Phase B: stronger worker-local rewrite logic

1. move current rewrite helpers in [workers/composer/compose_learned_symbolic.py](workers/composer/compose_learned_symbolic.py) into clearer internal functions
2. separate target-section regeneration from untouched-section replay
3. emit richer transform metadata

### Phase C: truth-plane enrichment

1. extend candidate sidecar payloads in [src/memory/candidates.ts](src/memory/candidates.ts)
2. keep new rewrite fields optional and backward-compatible

### Phase D: reranker and dataset hookup

1. add rewrite-local features to [src/pipeline/structureShadowReranker.ts](src/pipeline/structureShadowReranker.ts)
2. export richer rewrite rows through the dataset pipeline

## Tests

Minimum test additions:

1. rewrite payload contains explicit target and frozen section context
2. untouched sections remain byte- or summary-stable when the rewrite is local
3. candidate sidecars preserve rewrite context after later downstream failure
4. reranker export can distinguish localized rewrite from whole-piece retry
5. rewrite loses gracefully to baseline retry when the local fix is not actually better

## Rollout Gates

Do not treat localized rewrite as promoted until all of the following are true:

1. weak-section metrics improve more often than baseline retry on the same narrow lane
2. untouched-section stability remains high enough to avoid whole-piece drift
3. candidate sidecars preserve enough rewrite context for later dataset export and rollback analysis
4. human review can explain the rewrite win from sidecar evidence alone

## Current Recommendation

AXIOM should implement localized rewrite as a stronger internal mode of `learned_symbolic`, not as a separate public worker.
The guiding idea to borrow from DeepBach is constrained regeneration inside a chosen window, while the surrounding AXIOM contract remains section-aware, truth-plane driven, and rollback-safe.
