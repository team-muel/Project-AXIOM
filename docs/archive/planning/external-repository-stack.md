# AXIOM External Repository Stack

## Goal

This document organizes the nine external repositories currently referenced for AXIOM into practical layers.
It is not a claim that AXIOM should adopt all of them.
It is a prioritization document that says which repos matter first, what role each repo should play, and what AXIOM should not confuse them for.

## The Nine-Repo View

AXIOM should read the current external ecosystem in three layers.

### Layer 1: Core First-Pass Repositories

These are the first four repos to study because they map directly to AXIOM's most urgent gaps.

1. NotaGen
2. music21
3. DeepBach
4. sfizz

Layer-1 roles:

1. learned symbolic generator
2. theory and critique engine
3. controllable classical regeneration ideas
4. render backend

### Layer 2: Support Repositories

These are important, but they support lanes around the core system rather than replacing it.

1. Aria
2. MuseScore
3. LilyPond

Layer-2 roles:

1. piano continuation and expressive symbolic reference
2. human-readable score review surface
3. publication-quality score output

### Layer 3: Operations And Service Architecture Repositories

These matter more for how AXIOM is served, inspected, and orchestrated than for musical generation itself.

1. music21-mcp-server
2. LangGraph

Layer-3 roles:

1. analysis-service and multi-interface delivery reference
2. long-running stateful agent or workflow orchestration reference

## Detailed Layer 1 Notes

### 1. NotaGen

Why it is core:

1. The README describes large-scale pretraining, classical fine-tuning, RL follow-up, and a later NotaGen-X line.
2. The README explicitly frames conditional generation around `period-composer-instrumentation` prompts.
3. This is the closest current external candidate to AXIOM's missing learned symbolic backbone.

AXIOM role:

1. first serious learned symbolic backbone candidate
2. whole-piece symbolic generator for narrow-lane promotion work
3. future source of larger candidate branching under the search engine

Do not misread it as:

1. already integrated into AXIOM
2. already consuming AXIOM's full section or phrase or harmony schema
3. a reason to remove `music21` from the system

Primary AXIOM docs:

1. [symbolic-backbone-reference.md](symbolic-backbone-reference.md)
2. [notagen-class-adapter-design.md](notagen-class-adapter-design.md)

### 2. music21

Why it is core:

1. The README describes music21 as a toolkit for computer-aided musical analysis and computational musicology.
2. It remains the most direct foundation for parsing, harmonic analysis, voice-leading checks, notation conversions, and symbolic normalization.
3. AXIOM already depends on this style of functionality for critic and fallback behavior.

AXIOM role:

1. theory engine
2. canonical normalizer
3. critic backbone
4. fallback compose or repair spine

Do not misread it as:

1. sufficient by itself for master-level generative quality
2. something to remove once a learned generator appears

### 3. DeepBach

Why it is core:

1. The README explicitly calls it a steerable model for Bach chorales generation.
2. It demonstrates region-level regeneration, interactive control, and score-editor friendly usage.
3. Its strongest value for AXIOM is not broad style coverage but constrained regeneration logic.

AXIOM role:

1. reference for localized rewrite
2. reference for constrained regeneration windows
3. reference for user-steerable or operator-steerable repair policies

Do not misread it as:

1. AXIOM's main learned backbone
2. a general orchestral or broad-classical generator

Primary AXIOM docs:

1. [symbolic-backbone-reference.md](symbolic-backbone-reference.md)
2. [deepbach-style-localized-rewrite-design.md](deepbach-style-localized-rewrite-design.md)

### 4. sfizz

Why it is core:

1. The README describes sfizz as an SFZ parser and synth C++ library and JACK standalone client.
2. It is explicitly positioned as a library that can be integrated into other programs or used as a standalone client.
3. For AXIOM, this maps directly to headless render backend evolution once SFZ instrument libraries become a real runtime target.

AXIOM role:

1. future headless SFZ render backend
2. render infrastructure reference
3. sampler-engine axis for moving beyond one global GM SoundFont path

Do not misread it as:

1. a composition model
2. a critic or theory engine
3. a reason to change the canonical symbolic lane before render infrastructure is ready

## Detailed Layer 2 Notes

### 5. Aria

Why it is support rather than core-first:

1. The README describes it as a LLaMA 3.2 1B symbolic music model trained on roughly 60k hours of expressive solo-piano MIDI transcriptions.
2. The README also states that it performs best at continuing existing piano MIDI rather than composing from scratch.
3. That makes it strong for piano continuation and variation, but not the first choice for AXIOM's current `string_trio_symbolic` backbone promotion path.

AXIOM role:

1. piano continuation lane
2. development-section or bridge continuation reference
3. expressive piano variation experiments

Do not misread it as:

1. the first primary backbone for the current narrow trio lane

### 6. MuseScore

Why it is support rather than core-first:

1. The README describes MuseScore as open-source music notation software with MusicXML and MIDI import or export, PDF output, and an integrated sequencer and software synthesizer.
2. This is valuable for score inspection, playback, and plugin experimentation.
3. It is not AXIOM's core generator, but it is very useful for human review and proofreading.

AXIOM role:

1. human-readable score review surface
2. plugin or proofreading experimentation target
3. operator-visible score QA tool

Do not misread it as:

1. the core symbolic generation engine
2. the final publication renderer AXIOM should optimize for first

### 7. LilyPond

Why it is support rather than core-first:

1. The README describes LilyPond as a text-based music notation program devoted to producing high-quality sheet music and inspired by classical hand-engraving.
2. This makes it a strong publication renderer rather than an interactive score editor.
3. For AXIOM, LilyPond matters after a selected work is already good enough to deserve formal engraving.

AXIOM role:

1. final publication-quality score output
2. engraving surface for selected works
3. later pipeline stage after generation and evaluation are already settled

Do not misread it as:

1. a generator
2. the center of AXIOM's critique loop

## Detailed Layer 3 Notes

### 8. music21-mcp-server

Why it is operations-layer reference:

1. The README explicitly offers MCP, HTTP API, CLI, and Python library interfaces around one shared music21 analysis core.
2. It includes key analysis, harmony analysis, voice leading, pattern recognition, harmonization, counterpoint generation, and style imitation in a protocol-independent architecture.
3. The most useful lesson for AXIOM is service design, not copying the repo as a hard dependency.

AXIOM role:

1. reference for a separate analysis service or critic microservice
2. reference for operator-facing and automation-facing multi-interface analysis surfaces
3. reference for keeping core analysis logic independent from transport protocol

Do not misread it as:

1. a replacement for AXIOM's current runtime truth plane
2. a reason to split analysis into a service before the core musical contract is stable

### 9. LangGraph

Why it is operations-layer reference:

1. The README describes it as a low-level orchestration framework for long-running, stateful agents.
2. It emphasizes durable execution, human-in-the-loop, comprehensive memory, and production-ready deployment of stateful workflows.
3. These are directly relevant to AXIOM's autonomy, approval, retry, and overseer growth path.

AXIOM role:

1. reference for state-graph orchestration patterns
2. reference for durable long-running workflow design
3. reference for human approval checkpoints and persistent execution state

Do not misread it as:

1. an immediate mandatory dependency
2. a reason to replace the current queue or orchestrator before AXIOM's workflow boundaries are clearer

## Layered Reading Order

When planning AXIOM work, read the repositories in this order:

1. NotaGen
2. music21
3. DeepBach
4. sfizz
5. Aria
6. MuseScore
7. LilyPond
8. music21-mcp-server
9. LangGraph

This order reflects urgency for AXIOM, not general prestige.

## Execution Order Versus Repo Reading Order

The repository reading order above is not identical to the recommended implementation order.
AXIOM should read DeepBach and sfizz early, but it should not let either one displace the search-and-selection work that must follow the first learned backbone integration.

Recommended execution order:

1. bind one NotaGen-class learned backbone tightly to the existing `music21` baseline, normalizer, fallback path, and truth-plane contracts
2. expand paired candidate search and promote feedback-aware reranking so AXIOM wins by selection quality, not by trusting one learned sample
3. add DeepBach-style localized rewrite only after candidate-group comparison and shortlist control are stable enough to measure whether a repair stayed local
4. add sfizz as a headless SFZ render-backend track only after symbolic winner selection is stable enough that render changes do not confound backbone comparisons
5. use MuseScore and LilyPond later for human review and final score export once selected works are already strong enough to justify those surfaces
6. keep music21-mcp-server and LangGraph as later service-boundary and orchestration references, not as immediate dependencies

Important clarification:

1. the later MuseScore phase refers to score review and proofreading surfaces, not to the already-completed `MuseScore_General.sf3` SoundFont adoption
2. sfizz is a render-infrastructure axis, not a replacement for the symbolic backbone or critique loop
3. DeepBach is a localized-rewrite reference, not a reason to delay candidate search and reranker work

## Decision Table

| AXIOM Need | Best Current External Reference |
| ---- | ---- |
| learned symbolic backbone | NotaGen |
| theory or critique or normalization spine | music21 |
| constrained localized rewrite | DeepBach |
| future SFZ render backend | sfizz |
| piano continuation or variation lane | Aria |
| human-readable score proofreading | MuseScore |
| publication-quality engraving | LilyPond |
| analysis-service or critic microservice design | music21-mcp-server |
| stateful workflow or human-in-the-loop orchestration patterns | LangGraph |

## AXIOM Planning Impact

1. Backbone planning should stay centered on NotaGen plus music21 plus DeepBach, with sfizz added as the render-infrastructure fourth pillar.
2. Aria, MuseScore, and LilyPond should be treated as support-layer investments after the core symbolic lane is stronger.
3. music21-mcp-server and LangGraph should inform service boundaries and orchestration strategy, not distract from the core generation problem.

## Current Recommendation

AXIOM should not flatten these nine repos into one undifferentiated backlog.
The correct reading is layered.

1. First make NotaGen-class generation and `music21` baseline evaluation work as one disciplined narrow-lane system.
2. Immediately after that, spend the next budget on search expansion and feedback-aware reranking before treating localized rewrite or render backend work as the main story.
3. Then add DeepBach-style localized rewrite as a measured repair path inside the candidate-selection loop.
4. Then add sfizz as a headless render-backend path once symbolic comparisons are stable enough to survive render-stack changes.
5. Then strengthen human review and final score export through MuseScore and LilyPond.
6. Finally, borrow service-architecture and orchestration ideas from music21-mcp-server and LangGraph only when AXIOM's runtime complexity actually demands them.
