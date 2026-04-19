# NotaGen-Class Adapter Design

## Goal

This document describes how AXIOM should integrate a NotaGen-class conditional symbolic generator behind the existing `learned_symbolic` worker slot.
The design goal is not "run an external repo somehow".
The goal is to make a learned backbone consume AXIOM planning contracts, emit auditable candidate evidence, and degrade cleanly to the current `music21` baseline.

## Scope

In scope:

1. the `learned_symbolic` worker path in [src/composer/index.ts](src/composer/index.ts)
2. candidate generation and selection inside [src/pipeline/orchestrator.ts](src/pipeline/orchestrator.ts)
3. candidate sidecar persistence in [src/memory/candidates.ts](src/memory/candidates.ts)
4. response normalization into AXIOM `ComposeResult`, `SectionArtifactSummary`, `SectionTonalitySummary`, and `ComposeProposalEvidence`
5. fallback behavior back to `music21`

Out of scope:

1. replacing `music21` as the critic or theory engine
2. changing public manifest contracts to expose a vendor-specific model name
3. broad orchestration or long-form claims beyond the current narrow lane

## Current Code Anchors

The current learned-worker entrypoint already exists.

1. [src/composer/index.ts](src/composer/index.ts) resolves `composeWorker="learned_symbolic"`, calls `composeWithLearnedSymbolic(...)`, normalizes the worker response, and falls back to `composeWithMusic21(...)` on failure.
2. [src/pipeline/orchestrator.ts](src/pipeline/orchestrator.ts) already builds hybrid candidate requests, critiques each candidate, persists candidate snapshots, and records `proposalEvidence`, `revisionDirectives`, and `sectionTransforms` into truth-plane sidecars.
3. [src/pipeline/hybridSymbolicCandidatePool.ts](src/pipeline/hybridSymbolicCandidatePool.ts) already knows how to run paired baseline and learned candidates on the same normalized request.
4. [src/memory/candidates.ts](src/memory/candidates.ts) already preserves per-candidate manifest, section-artifacts, MIDI, and reranker score sidecars.
5. [workers/composer/compose_learned_symbolic.py](workers/composer/compose_learned_symbolic.py) already proves the current narrow lane can accept `revisionDirectives`, prior `sectionArtifacts`, and targeted rewrite metadata.

This means the missing work is not the entire learned lane from scratch.
The missing work is a stronger adapter, better normalization, and a stricter promotion path.

## Design Principles

1. Keep the public worker name generic: `learned_symbolic` remains the runtime slot.
2. Keep provider-specific logic inside an adapter layer.
3. Preserve `music21` as the fallback and the theory-engine baseline.
4. Never let the learned worker write directly into canonical manifest fields before AXIOM normalization.
5. Persist enough truth-plane evidence to reconstruct failures, disagreements, and review outcomes later.

## Target Lane

The first concrete adapter target is the current narrow lane:

1. family: `string_trio_symbolic`
2. workflow: `symbolic_only` first, then `symbolic_plus_audio`
3. forms: miniature and short fixed-form families only
4. worker role: whole-piece candidate generation first, localized rewrite later

This keeps the integration problem smaller than a general orchestral or piano-allocation problem.

## End-State Architecture

```text
Planner / CompositionPlan
  -> AXIOM learned adapter request builder
  -> NotaGen-class inference backend
  -> adapter response parser
  -> AXIOM canonical normalizer
  -> candidate sidecar persistence
  -> shared critique and reranker path
  -> selected winner continues through humanize/render/audio
```

The learned generator is a proposal source inside AXIOM's pipeline, not a separate product.

## Proposed Module Split

Keep the current public dispatch path stable, but split provider-specific responsibilities behind helper modules.

### TypeScript side

Recommended additions under `src/composer/`:

1. `learnedAdapter.ts`
   - provider-agnostic request builder and response validator for learned symbolic workers
2. `learnedNotagenAdapter.ts`
   - NotaGen-class prompt packing, backend process invocation, and provider-specific response parsing
3. `learnedNormalizer.ts`
   - converts provider-native output into AXIOM `ComposeResult` fields and normalization warnings

### Python side

Recommended additions under `workers/composer/learned_symbolic/`:

1. `notagen_backend.py`
   - load checkpoint, tokenizer, and inference configuration
2. `prompt_packing.py`
   - convert AXIOM plan into provider-native conditioning text or structured prompt
3. `abc_postprocess.py`
   - convert provider-native ABC or symbolic output into a stable intermediate form
4. `symbolic_projection.py`
   - derive section-level event summaries needed by AXIOM normalization

Keep [workers/composer/compose_learned_symbolic.py](workers/composer/compose_learned_symbolic.py) as the worker entrypoint so the runtime contract does not change.

## Request Contract

The current worker already receives most of what it needs.
The strengthened adapter should treat the payload below as canonical.

### Required request fields

1. `prompt`
2. `compositionPlan`
3. `selectedModels`
4. `songId` or stable `outputPath`
5. `attemptIndex`

### Important optional fields

1. `key`
2. `tempo`
3. `form`
4. `targetInstrumentation`
5. `revisionDirectives`
6. `sectionArtifacts`

### Normalized internal prompt pack

The adapter should derive a deterministic internal prompt pack from the request:

1. top-level style cue: form, key, meter, tempo, period/composer/instrumentation mapping when available
2. section table: `sectionId`, role, measures, phrase function, cadence role, harmonic plan, texture role hints
3. motif or narrative notes when present in `CompositionPlan`
4. expression defaults and section-local expression cues only when they are stable enough to serialize without ambiguity

The same `CompositionPlan` must always yield the same prompt pack for the same adapter version.

## Provider Mapping

The first provider mapping should be explicit and narrow.

### AXIOM to NotaGen-class prompt mapping

1. `form`, `key`, `tempo`, and instrumentation map to the provider's main conditioning text
2. section plan and phrase or harmony cues are serialized into a deterministic side prompt or control block
3. if the provider only accepts one freeform string, AXIOM should still build that string from ordered sections, not from ad-hoc prose
4. if the provider accepts ABC-specific control tokens, keep those tokens inside the adapter only

### Provider limitations to accept up front

1. provider-native conditioning may be weaker than AXIOM's schema richness
2. section boundaries may be approximate rather than exact in the raw provider output
3. generated instrumentation may not perfectly honor AXIOM role labels without post-normalization

The adapter must log these gaps as normalization warnings rather than hiding them.

## Response Contract

The worker should continue to return a provider-neutral response to TypeScript.

### Required response fields

1. `ok`
2. `proposalMidiPath`
3. `proposalSummary`
4. `proposalMetadata`
5. `proposalSections`

### `proposalMetadata` expectations

1. `lane`
2. `provider`
3. `model`
4. `generationMode`
5. `confidence`
6. `normalizationWarnings`

### `proposalSections` expectations

1. `sectionId`
2. `role`
3. `measureCount`
4. optional `tonalCenter`
5. optional `phraseFunction`
6. `leadEvents`
7. `supportEvents`
8. `noteHistory`
9. optional `transform`

This matches the current normalization path in [src/composer/index.ts](src/composer/index.ts) and avoids another public contract split.

## Normalization Pipeline

The adapter is only useful if the output becomes first-class AXIOM evidence.

### Stage 1: provider-native parse

1. validate the returned ABC or symbolic data
2. render or convert to MIDI
3. capture provider-side confidence and warnings

### Stage 2: section projection

1. align generated events to AXIOM section windows
2. derive `leadEvents`, `supportEvents`, and `noteHistory`
3. infer approximate `tonalCenter` per section when the provider does not return it directly

### Stage 3: AXIOM normalization

1. map sections into `SectionArtifactSummary`
2. map tonal centers into `SectionTonalitySummary`
3. map provider metadata into `ComposeProposalEvidence`
4. emit `sectionTransforms` only when rewrite mode is actually used

### Stage 4: truth-plane persistence

1. persist candidate MIDI
2. persist candidate-manifest and section-artifacts sidecar
3. preserve provider, model, lane, generation mode, confidence, and warnings in `proposalEvidence`

## Failure And Fallback

Fallback semantics are already part of the current runtime and must remain strict.

### Hard failure conditions

1. missing or empty MIDI output
2. provider crash or timeout
3. conversion failure from provider-native output into MIDI
4. impossible section projection

### Fallback behavior

1. log the learned failure with reason
2. switch to `buildMusic21FallbackExecutionPlan(...)`
3. compose the baseline candidate under the same normalized request
4. do not abort the full pipeline if the learned worker alone fails

### Truth-plane rule

If the learned worker fails before candidate evidence becomes usable, AXIOM should keep the error in logs but continue with the baseline path.
If the learned worker succeeds and later stages fail, candidate sidecars must remain readable.

## Candidate And Review Surfaces

The existing truth-plane is already close to sufficient.
The strengthened adapter must preserve these fields consistently:

1. `proposalEvidence.worker=learned_symbolic`
2. `proposalEvidence.provider`
3. `proposalEvidence.model`
4. `proposalEvidence.promptPackVersion`
5. `proposalEvidence.planSignature`
6. `proposalEvidence.generationMode`
7. `proposalEvidence.confidence`
8. `proposalEvidence.summary`
9. `proposalEvidence.normalizationWarnings`

This is the minimum needed for:

1. candidate audit
2. reranker training
3. promotion analysis
4. rollback analysis

## File-Level Change Plan

### Phase A: adapter isolation

1. refactor learned request building out of [src/composer/index.ts](src/composer/index.ts)
2. add provider-neutral validator and normalization helpers
3. keep external behavior unchanged

### Phase B: NotaGen-class provider hookup

1. add provider-specific Python backend module
2. add deterministic prompt packing from `CompositionPlan`
3. support one provider-specific output format end to end

### Phase C: richer normalization

1. improve section projection quality
2. add normalization warnings for mismatched section counts, role collapse, or instrumentation drift
3. expose provider-native confidence and summary into `proposalEvidence`

### Phase D: promotion gate

1. keep paired baseline and learned candidate generation on the same request
2. evaluate with the existing critique and reranker stack
3. only permit promotion when reviewed evidence clears the narrow-lane gate in [backbone-search-reranker-matrix.md](backbone-search-reranker-matrix.md)

## Current Implementation Status

1. The current tree already implements the Phase A through C scaffold for the narrow lane: learned request packing and dispatch are isolated under `src/composer/learnedClient.ts`, `src/composer/learnedAdapter.ts`, `src/composer/learnedNotagenAdapter.ts`, and `src/composer/learnedNormalizer.ts`, while `workers/composer/compose_learned_symbolic.py` stays the public worker entrypoint.
2. The active provider path is still contract-first and deterministic. Prompt packing, projection, and targeted rewrite behavior currently run through internal helper modules under `workers/composer/learned_symbolic/` so AXIOM can prove fallback, normalization, and truth-plane persistence before claiming a stronger external backbone hookup.
3. Whole-piece learned candidates and targeted localized rewrites now both normalize back into canonical `proposalEvidence`, section artifacts, tonalities, and transform metadata, so the shared evaluator, candidate sidecars, dataset export, and operator surfaces can all read the same evidence without learned-only special cases.
4. `npm run ml:summarize:learned-backbone` now serves as the narrow-lane benchmark audit surface for this adapter: it reports paired-run counts, reviewed disagreement counts, retry-localization stability, failure modes, and sample-readiness against the matrix floors, but it does not change the promotion gate itself.

## Tests

Minimum test additions:

1. adapter request packing is deterministic for the same plan
2. provider-native output that lacks valid MIDI triggers clean fallback
3. normalized learned candidate persists `proposalEvidence` and sidecars correctly
4. paired baseline and learned candidates remain comparable under the same `CompositionPlan`
5. later humanize or render failure does not erase learned candidate evidence

## Rollout Gates

The adapter is ready for guarded use only when all of the following are true:

1. it survives the current narrow-lane benchmark pack without breaking fallback semantics
2. reviewed sample quality exceeds the paired `music21` baseline often enough to matter
3. reranker and operator surfaces can explain learned wins and losses from truth-plane evidence alone
4. rollback is still one config flip away

## Current Recommendation

Build the first learned backbone integration as a provider adapter, not as a new runtime identity.
AXIOM should keep the slot name `learned_symbolic`, keep `music21` as the fallback spine, and let the NotaGen-class adapter prove itself through paired candidates, truth-plane persistence, and reviewed narrow-lane wins.
