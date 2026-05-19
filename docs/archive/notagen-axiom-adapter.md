# NotaGen AXIOM Adapter — Architecture & Fine-Tuning Guide

## Overview

AXIOM uses a two-stage strategy to produce AXIOM-control-following symbolic music generation.

**Stage 1 (current):** NotaGen native generates many ABC candidates from a coarse period/composer/instrumentation prompt. AXIOM then applies craft scoring, preference reranking, and quality filtering to select the best candidate.

**Stage 2 (target):** A fine-tuned adapter model takes the full AXIOM control block (conditioningText + controlLines) as input and generates ABC scores that directly follow the structural plan — section layout, cadences, energy curves, tonal targets, motif plan.

Stage 1 is a realistic production path today. Stage 2 is the target architecture once sufficient approved data has been accumulated.

---

## Stage 1: Generation + Reranking (Current)

### How it works

```
AXIOM composition plan
        │
        ▼
learnedNotagenAdapter.ts
  builds providerRequest:
    conditioningText   → "Generate interleaved ABC notation for a classical string trio..."
    controlLines       → lane=, form=, key=, meter=, tempo=, instrumentation=, section ...
        │
        ▼
notagen_backend._generate_local()
  converts header → NotaGen native prompt:
    %Romantic
    %Brahms, Johannes
    %String_Trio
        │
        ▼
NotaGen native model
  (patch-level GPT-2 decoder, NOTAGEN_ENGINE=notagen_native)
  generates full ABC score — X:1, headers, body
        │
        ▼
AXIOM craft scoring + preference reranking
  craftScoring.ts: syntaxValidity, sectionContractFit, cadenceStrength,
                   tonalReturn, motifSurvival, voiceIndependence, ...
  preferenceModel.ts: trained preference reranker
        │
        ▼
Selected candidate → proposalEvidence stored with abcText, providerRequest
```

### What AXIOM control is used for in Stage 1

- **At generation time:** only period, composer, instrumentation reach the NotaGen model; the full structural plan (section cadences, energy, tonal targets) does NOT constrain the model.
- **Post-generation:** section plan is used for craft scoring, tonal return evaluation, cadence alignment, and energy curve validation.
- **Selection:** preference reranker scores candidates; the plan-aligned candidate wins.

### Current limitations

1. NotaGen native ignores AXIOM's section-level structural plan at generation time.
2. Fine-grained control (cadence type, energy shape, motif continuity) only acts as a filter — not as a generative constraint.
3. "AXIOM plans, NotaGen generates independently, AXIOM validates" — not ideal.

---

## Stage 2: Control-Following Fine-Tuning (Target)

### Goal

Fine-tune a causal LM on (AXIOM control block → approved ABC score) pairs so the model learns to generate ABC scores that follow the full structural plan directly.

### Expected improvements

- Section cadences placed where AXIOM specifies
- Energy/density curves tracked across sections
- Motif re-use and development following the motif policy
- Tonal return and tonicization window alignment
- Fewer resampling iterations needed

### Training data requirement

Sufficient approved candidates with `proposalEvidence.abcText` and `proposalEvidence.providerRequest.controlLines`. Aim for **200+ diverse approved pairs** before Stage 2 training is likely to generalise.

---

## Data Pipeline

### Step 1 — Generate and approve candidates (ongoing, Stage 1)

Run AXIOM composition normally. After listener review, approved candidates are stored in:

```
outputs/<songId>/manifest.json               { approvalStatus: "approved" }
outputs/<songId>/candidates/<id>/candidate-manifest.json
  └── proposalEvidence
        ├── abcText           ← ABC score text (X:1, headers, body)
        ├── providerRequest   ← AXIOM control block (conditioningText + controlLines)
        └── promptPack        ← structured section plan
```

`abcText` is populated when `NOTAGEN_ENGINE=notagen_native` or `=hf_causal_lm` (not template backend).

### Step 2 — Export SFT dataset

```bash
npm run export:notagen-sft
# or with options:
node scripts/export-notagen-sft-dataset.mjs --root=outputs --snapshot=2025-05-15 --min-score=0.65
```

Output: `outputs/_system/ml/notagen-sft/<snapshot>/sft-pairs.jsonl`

Each row:
```json
{
  "id": "<sha256>",
  "songId": "my-song-001",
  "planSignature": "lane=string_trio_symbolic|form=miniature|...",
  "generationMode": "notagen_abc_inference_hf_causal_lm",
  "instruction": "Generate interleaved ABC notation for a classical string trio...\n%%axiom_control_begin\nlane=string_trio_symbolic\nplan_signature=...\nabc_format=interleaved\nform=miniature\nkey=Gmin\nmeter=4/4\ntempo=84\ninstrumentation=Violin:lead,Viola:counterline,Cello:bass\nsection id=s1 role=theme_a ...\nsection id=s2 role=recap ...\n%%axiom_control_end",
  "output": "X:1\nT:AXIOM plan_signature=...\nM:4/4\nL:1/8\nQ:1/4=84\nK:Gmin\n%%score ...\n...",
  "meta": { "provider": "learned", "model": "...", "craftScoreSummary": { ... } }
}
```

**Filtering options:**
| Option | Effect |
|--------|--------|
| `--min-score=0.65` | Exclude rows with avg craftScore below 0.65 (higher quality training set) |
| `--include-mock` | Include mock-backend rows (for testing only; they lack real musical quality) |

### Step 3 — Train the adapter

```bash
npm run ml:train:notagen-adapter -- --snapshot=2025-05-15
# or with LoRA (recommended for GPU):
npm run ml:train:notagen-adapter -- --snapshot=2025-05-15 --mode=lora --min-score=0.65
```

---

## SFT Prompt Format

### Instruction (input)

```
{conditioningText}
%%axiom_control_begin
lane=string_trio_symbolic
plan_signature=lane=string_trio_symbolic|form=miniature|...
prompt_pack_version=learned_symbolic_prompt_pack_v1
abc_format=interleaved
form=miniature
key=Gmin
meter=3/4
tempo=72
instrumentation=Violin:lead,Viola:counterline,Cello:bass
section id=s1 role=theme_a label=Primary theme measures=4 motif_ref=none energy=0.5 density=0.4
section id=s2 role=development label=Development measures=8 motif_ref=m1 energy=0.7 density=0.6
section id=s3 role=recap label=Recap measures=4 motif_ref=m1 energy=0.4 density=0.3
%%axiom_control_end
```

This is the same format produced by `abc_prompt.py`'s `build_notagen_input_string()`, ensuring training and inference use identical prompts.

### Output (target)

```
X:1
T:AXIOM plan_signature=lane=string_trio_symbolic|form=miniature|...
C:AXIOM plan_signature=...
M:3/4
L:1/8
Q:1/4=72
K:Gmin
%% lane=string_trio_symbolic
%% abc_format=interleaved
...
[V:1] G4 A2 | B6 | ...
[V:2] d4 e2 | d6 | ...
[V:3] G,6  | G,6 | ...
```

---

## Running the Pipeline

### Full pipeline

```bash
# 1. Export SFT pairs from approved manifests
npm run export:notagen-sft

# 2. Train LoRA adapter (GPU recommended; 200+ pairs needed for generalisation)
npm run ml:train:notagen-adapter -- --snapshot=$(date +%Y-%m-%d) --mode=lora --min-score=0.65

# 3. Check the run summary
cat outputs/_system/ml/notagen-adapter/<run-id>/run_summary.json
```

### Export options

```bash
# Explicit root and snapshot
node scripts/export-notagen-sft-dataset.mjs --root=outputs --snapshot=2025-05-15

# Quality gate (recommended for training)
node scripts/export-notagen-sft-dataset.mjs --min-score=0.65

# Include mock rows (for pipeline testing only)
node scripts/export-notagen-sft-dataset.mjs --include-mock
```

### Training options

```bash
# Full fine-tuning (small models / no GPU)
python scripts/train-notagen-axiom-adapter.py --snapshot=2025-05-15

# LoRA fine-tuning (recommended)
python scripts/train-notagen-axiom-adapter.py \
    --snapshot=2025-05-15 \
    --mode=lora \
    --model=EleutherAI/gpt-neo-1.3B \
    --epochs=5 \
    --min-score=0.65

# Explicit JSONL path
python scripts/train-notagen-axiom-adapter.py \
    --jsonl=outputs/_system/ml/notagen-sft/2025-05-15/sft-pairs.jsonl \
    --mode=lora
```

---

## Model Selection

### Recommended base models

| Model | Parameters | Notes |
|-------|-----------|-------|
| `EleutherAI/gpt-neo-125M` | 125M | Default; fast to fine-tune; limited capacity |
| `EleutherAI/gpt-neo-1.3B` | 1.3B | Better generalisation; requires GPU |
| Any ABC-pretrained GPT | varies | Preferred if available (already ABC-fluent) |

### LoRA vs full SFT

| | Full SFT | LoRA |
|-|----------|------|
| Hardware | CPU / small GPU | GPU (VRAM ≥ 8GB recommended) |
| Disk | Full model copy | Small adapter (~10–100MB) |
| Inference | Standard HF | Load base + adapter via peft |
| Catastrophic forgetting risk | Higher | Lower |
| Recommended for | Testing, tiny models | Production use |

### Note on NotaGen native weights

The NotaGen native engine (`NOTAGEN_ENGINE=notagen_native`) uses a custom hierarchical decoder (Patchilizer + patch-level GPT-2) that is **not compatible** with `AutoModelForCausalLM`. This script targets standard HF causal LMs.

To fine-tune the actual NotaGen native weights, use the training code from the official NotaGen repository (<https://github.com/ElectricAlexis/NotaGen>) with the SFT JSONL as the data source. The AXIOM control block becomes the prompt prefix in that training loop.

---

## Artifact Paths

| Path | Contents |
|------|----------|
| `outputs/_system/ml/notagen-sft/<snapshot>/sft-pairs.jsonl` | SFT training pairs |
| `outputs/_system/ml/notagen-sft/<snapshot>/summary.json` | Export statistics |
| `outputs/_system/ml/notagen-adapter/<run-id>/adapter_model/` | Saved model / LoRA weights |
| `outputs/_system/ml/notagen-adapter/<run-id>/run_summary.json` | Training metrics |
| `outputs/_system/ml/notagen-preferences/<snapshot>/preferences.jsonl` | DPO preference data |
| `outputs/_system/preference-reranker-snapshot.json` | Trained preference reranker |

---

## Current Status

| Component | Status |
|-----------|--------|
| AXIOM control block preserved in `proposalEvidence.providerRequest` | ✅ Done |
| `abcText` stored in `proposalEvidence` | ✅ Done |
| SFT export script | ✅ Done |
| HF adapter training script | ✅ Done |
| NotaGen native fine-tuning loop | ⬜ Requires NotaGen repo integration |
| Inference path using fine-tuned adapter | ⬜ Add `NOTAGEN_ENGINE=axiom_adapter` |
| Evaluation harness (craft score delta) | ⬜ Planned |
