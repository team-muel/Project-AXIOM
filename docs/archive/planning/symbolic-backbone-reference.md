# AXIOM Symbolic Backbone Reference

## Goal

This document records the external repositories and model families that are most relevant to AXIOM's learned symbolic roadmap.
It is a reference document, not a runtime contract.

For the full layered nine-repository stack, including render, engraving, analysis-service, and agent-orchestration references, see [external-repository-stack.md](external-repository-stack.md).

AXIOM should keep long-term contracts model-generic, but it should still be explicit about which outside systems are the strongest current reference points for:

1. learned symbolic backbone promotion
2. steerable partial regeneration and localized rewrite
3. canonical music-theory analysis and normalization
4. continuation-focused piano generation

## Reading Rule

Use this document when deciding what kind of learned worker or rewrite policy AXIOM should prototype next.
Do not copy external repository names into the runtime API or persisted truth-plane schema unless AXIOM intentionally adopts a vendor-specific adapter layer.

## Role Summary

| System | Best AXIOM Role | Why It Matters | Not The Right First Claim |
| ---- | ---- | ---- | ---- |
| NotaGen | primary learned symbolic backbone candidate | public pretrained, classical fine-tuned, RL-improved checkpoints, conditional classical prompting | do not assume it is already AXIOM-integrated or schema-conditioned without adapter work |
| DeepBach | localized rewrite and controllable regeneration reference | steerable sampling, partial region regeneration, music21 or MuseScore friendly workflow | not a general classical backbone for AXIOM's broader roadmap |
| music21 | canonical theory engine, analyzer, normalizer, fallback baseline | computational musicology toolkit, symbolic parsing, theory checks, notation conversions | not the sole path to master-level generative quality |
| Aria | piano continuation or variation reference | strong expressive solo-piano pretraining and continuation tooling | not the first narrow-lane whole-piece backbone for `string_trio_symbolic` |

## Candidate Notes

### NotaGen

Why it is the strongest direct backbone reference:

1. The README describes a three-stage training path: large-scale pretraining, classical fine-tuning, and RL follow-up.
2. It publishes pretrained model scales, a classical fine-tuned checkpoint, and a later NotaGen-X line.
3. The README explicitly frames conditional prompting around `period-composer-instrumentation`, which is close to AXIOM's desired classical control surface.

AXIOM interpretation:

1. Treat NotaGen as the most direct current candidate for `B2` in [backbone-search-reranker-matrix.md](backbone-search-reranker-matrix.md).
2. If adopted, wrap it behind `learned_symbolic` rather than exposing `notagen` as a permanent runtime contract.
3. The adapter burden is still substantial: AXIOM needs deterministic plan-to-prompt normalization, ABC or symbolic conversion, section alignment, artifact extraction, and fallback semantics.
4. The first success criterion is not "NotaGen runs" but "the NotaGen-class adapter beats the paired `music21` baseline on reviewed narrow-lane evidence".

Immediate AXIOM fit:

1. narrow `string_trio_symbolic` backbone experiment
2. future conditional whole-piece generation for fixed classical form families
3. later candidate branching source under a larger search budget

### DeepBach

Why it still matters:

1. The README explicitly describes it as a steerable model for Bach chorales generation.
2. It demonstrates interactive or partial region regeneration rather than only one-shot unconditional sampling.
3. Its workflow remains closely adjacent to music21 and score-editor tooling.

AXIOM interpretation:

1. Treat DeepBach as a design reference for `B3`, not as AXIOM's main learned backbone.
2. The most useful ideas are constrained resampling, local regeneration windows, and user-steerable repair.
3. Its value to AXIOM is highest in localized rewrite, section repair, and "regenerate only this weak span" behavior.

Immediate AXIOM fit:

1. targeted rewrite policy design
2. controllable partial-regeneration UX or operator tooling
3. future pairwise repair experiments against deterministic `music21` retries

### music21

Why it remains central:

1. The project describes itself as a toolkit for computer-aided musical analysis and computational musicology.
2. It remains the cleanest foundation for symbolic parsing, harmonic checks, voice-leading analysis, and notation conversion.
3. AXIOM already depends on it conceptually and operationally for compose fallback, critic logic, and normalization work.

AXIOM interpretation:

1. Keep music21 as the theory engine, canonical normalizer, and fallback baseline even after learned promotion work begins.
2. music21 is not the enemy of learned generation; it is the system that makes learned outputs legible, auditable, and repairable inside AXIOM.
3. Removing music21 from the loop too early would weaken critic quality, rollback confidence, and truth-plane interpretability.

Immediate AXIOM fit:

1. critic and evaluation backbone
2. canonical symbolic normalization and artifact extraction
3. fallback compose or repair path

### Aria

Why it is interesting but narrower:

1. The README describes Aria as a pretrained symbolic music model based on LLaMA 3.2 1B.
2. It was trained on roughly 60k hours of expressive solo-piano MIDI transcriptions.
3. The README also states that it performs best when continuing existing piano MIDI rather than generating from scratch.

AXIOM interpretation:

1. Treat Aria as a strong reference for piano continuation, variation, connective tissue, and embedding-driven retrieval.
2. Do not treat it as the first primary backbone candidate for AXIOM's current `string_trio_symbolic` promotion path.
3. It may become more relevant when AXIOM opens a piano lane or wants a continuation engine for development sections, bridges, or variations.

Immediate AXIOM fit:

1. piano continuation lane
2. variation or bridge generation experiments
3. embedding-based similarity or retrieval support for future search policies

## AXIOM Adoption Order

Recommended order:

1. keep `music21` as the canonical theory-engine baseline and fallback
2. prototype one NotaGen-class adapter as the first serious learned backbone candidate
3. borrow DeepBach-style partial-regeneration ideas for localized rewrite and repair control
4. evaluate Aria later for piano-specific continuation or variation lanes

This order matches AXIOM's current narrow-lane priorities better than jumping first to a piano continuation model or replacing the theory engine.

## Integration Rules

1. External repos are references, not proof of AXIOM capability.
2. A referenced model family only becomes an AXIOM backbone after it can consume AXIOM plan contracts and survive the same truth-plane evaluation path.
3. Any adopted backbone must degrade cleanly to `music21`.
4. AXIOM should store worker-generic `provider` and `model` evidence in candidate sidecars, not build a permanent vendor-specific contract into manifests.

## Decision Table

| AXIOM Need | Best Current Reference |
| ---- | ---- |
| first serious learned symbolic backbone | NotaGen |
| localized rewrite or constrained regeneration ideas | DeepBach |
| theory engine, normalization, critic backbone | music21 |
| piano continuation or variation lane | Aria |

## Immediate Planning Impact

1. In [multimodel-composition-pipeline.md](multimodel-composition-pipeline.md), "real learned symbolic backbone" should be read first as a NotaGen-class adapter challenge, not a vague placeholder.
2. In [backbone-search-reranker-matrix.md](backbone-search-reranker-matrix.md), `B2` should be instantiated first with a NotaGen-class whole-piece generator and `B3` should add DeepBach-style localized rewrite ideas.
3. In [truth-plane-dataset-design.md](truth-plane-dataset-design.md), the internal AXIOM datasets remain separate from external public-domain pretraining corpora, but they become the fine-tuning and reranking evidence loop around any NotaGen-class backbone.

## Current Recommendation

The strongest immediate move for AXIOM is not to search indefinitely for many candidate repos.
It is to do one disciplined thing:

1. keep `music21` as the theory and fallback spine
2. treat NotaGen as the first serious learned backbone candidate
3. use DeepBach as the conceptual model for localized rewrite control
4. hold Aria for a later piano continuation or variation lane

That combination is the most direct path from the current sketch-engine state toward a real learned symbolic backbone plus search plus critique architecture.
