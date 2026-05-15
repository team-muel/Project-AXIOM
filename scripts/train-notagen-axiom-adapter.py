"""Train an AXIOM-control-following fine-tuned adapter for NotaGen-class models.

Stage 2 of the AXIOM NotaGen pipeline:

  Stage 1 (current):  NotaGen native -> many candidates -> AXIOM craft scoring + reranking
  Stage 2 (this):     Fine-tuned adapter -> AXIOM-control-following generation

Input
-----
SFT JSONL produced by ``npm run ml:export:notagen-sft``:

  outputs/_system/ml/notagen-sft/<snapshot>/sft-pairs.jsonl

Each line:
  {
    "id": "<hash>",
    "songId": "...",
    "planSignature": "...",
    "generationMode": "notagen_abc_inference_hf_causal_lm",
    "instruction": "<conditioningText>\\n%%axiom_control_begin\\n...\\n%%axiom_control_end",
    "output": "X:1\\nT:...\\n...",
    "meta": { ... }
  }

Prompt format (Alpaca-style)
----------------------------
  ### Instruction:
  {instruction}

  ### Response:
  {output}

Supported training modes
------------------------
  --mode=sft     Full supervised fine-tuning (small models; default).
  --mode=lora    LoRA (Low-Rank Adaptation) via peft -- recommended for GPU.

Prerequisites
-------------
  pip install transformers datasets accelerate
  pip install peft   # for --mode=lora

Usage
-----
  # SFT from latest export snapshot:
  python scripts/train-notagen-axiom-adapter.py --snapshot=2025-05-15

  # LoRA fine-tuning with quality gate:
  python scripts/train-notagen-axiom-adapter.py \\
      --snapshot=2025-05-15 --mode=lora --min-score=0.65

  # Explicit JSONL path:
  python scripts/train-notagen-axiom-adapter.py \\
      --jsonl=outputs/_system/ml/notagen-sft/2025-05-15/sft-pairs.jsonl \\
      --mode=lora --model=EleutherAI/gpt-neo-125M

Output
------
  outputs/_system/ml/notagen-adapter/<run-id>/
    adapter_model/   -- HuggingFace model / LoRA adapter weights
    run_summary.json -- final loss, dataset stats, config snapshot

Notes on NotaGen native
-----------------------
The NotaGen native engine (NOTAGEN_ENGINE=notagen_native) uses a custom
hierarchical decoder (Patchilizer + patch-level GPT) that is NOT compatible
with HuggingFace AutoModelForCausalLM.  This script targets HF-compatible
causal LM checkpoints (hf_causal_lm path or any GPT-2/GPT-Neo/GPT-J model
fine-tuned on ABC notation).

For native NotaGen weights, you would need to adapt the NotaGen training
loop from the official repo (https://github.com/ElectricAlexis/NotaGen).
The SFT JSONL exported here can be used as the data source for that process.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------

def _require(package: str, install_hint: str) -> None:
    try:
        __import__(package)
    except ImportError:
        sys.exit(f"ERROR: {package} is required. Install with:\n  {install_hint}\n")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Fine-tune a HF causal LM to follow AXIOM control blocks.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    p.add_argument("--root", default="outputs",
                   help="AXIOM output directory (default: outputs)")
    p.add_argument("--snapshot", default=None,
                   help="SFT snapshot ID from ml:export:notagen-sft (e.g. 2025-05-15)")
    p.add_argument("--jsonl", default=None,
                   help="Explicit path to sft-pairs.jsonl (overrides --snapshot)")
    p.add_argument("--model", default="EleutherAI/gpt-neo-125M",
                   help="HuggingFace model id or local path (default: EleutherAI/gpt-neo-125M)")
    p.add_argument("--mode", choices=["sft", "lora"], default="sft",
                   help="Training mode: sft=full fine-tuning, lora=LoRA adapter (default: sft)")
    p.add_argument("--epochs", type=int, default=3,
                   help="Training epochs (default: 3)")
    p.add_argument("--batch-size", type=int, default=4,
                   help="Per-device training batch size (default: 4)")
    p.add_argument("--max-length", type=int, default=1024,
                   help="Max token length for prompt+completion (default: 1024)")
    p.add_argument("--lr", type=float, default=5e-5,
                   help="Learning rate (default: 5e-5)")
    p.add_argument("--lora-r", type=int, default=16,
                   help="LoRA rank (default: 16)")
    p.add_argument("--lora-alpha", type=int, default=32,
                   help="LoRA alpha (default: 32)")
    p.add_argument("--min-score", type=float, default=0.0,
                   help="Exclude rows whose avg craftScore is below this (default: 0.0)")
    p.add_argument("--out", default=None,
                   help="Output directory override")
    p.add_argument("--verbose", action="store_true")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

CRAFT_DIMS = [
    "syntaxValidity", "sectionContractFit", "cadenceStrength", "tonalReturn",
    "motifSurvival", "voiceIndependence", "phraseShape", "registerIdiomaticFit",
]


def _safe_float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _avg_craft_score(row: dict[str, Any]) -> float | None:
    cs = (row.get("meta") or {}).get("craftScoreSummary") or {}
    scores = [_safe_float(cs.get(d)) for d in CRAFT_DIMS]
    scores = [s for s in scores if s is not None]
    return sum(scores) / len(scores) if scores else None


def _build_prompt(instruction: str, output: str) -> str:
    """Alpaca-style prompt — identical format at training and inference time."""
    return f"### Instruction:\n{instruction}\n\n### Response:\n{output}"


def _load_jsonl(
    jsonl_path: Path,
    min_score: float = 0.0,
    verbose: bool = False,
) -> list[str]:
    """Load and filter SFT pairs; return formatted prompt strings."""
    if not jsonl_path.is_file():
        sys.exit(f"ERROR: SFT JSONL not found: {jsonl_path}")

    prompts: list[str] = []
    skipped = 0

    with jsonl_path.open(encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                if verbose:
                    print(f"  [line {line_no}] JSON parse error: {exc}")
                continue

            instruction = str(row.get("instruction") or "").strip()
            output = str(row.get("output") or "").strip()
            if not instruction or not output:
                skipped += 1
                continue

            if min_score > 0:
                avg = _avg_craft_score(row)
                if avg is not None and avg < min_score:
                    skipped += 1
                    continue

            prompts.append(_build_prompt(instruction, output))

    if verbose:
        print(f"  Loaded {len(prompts)} prompts, skipped {skipped}")

    return prompts


# ---------------------------------------------------------------------------
# Model + tokenizer loading
# ---------------------------------------------------------------------------

def _load_model_and_tokenizer(
    model_name: str,
    mode: str,
    lora_r: int,
    lora_alpha: int,
) -> tuple[Any, Any]:
    from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: PLC0415

    print(f"Loading tokenizer: {model_name}")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print(f"Loading model: {model_name} (mode={mode})")
    model = AutoModelForCausalLM.from_pretrained(model_name)

    if mode == "lora":
        _require("peft", "pip install peft")
        from peft import LoraConfig, TaskType, get_peft_model  # noqa: PLC0415

        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=lora_r,
            lora_alpha=lora_alpha,
            lora_dropout=0.05,
            bias="none",
            # Target attention projection layers for GPT-2 / GPT-Neo / GPT-J
            target_modules=["c_attn", "c_proj", "q_proj", "v_proj"],
        )
        model = get_peft_model(model, lora_config)
        model.print_trainable_parameters()

    return model, tokenizer


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def _train(
    model: Any,
    tokenizer: Any,
    prompts: list[str],
    *,
    epochs: int,
    batch_size: int,
    max_length: int,
    lr: float,
    output_dir: Path,
    verbose: bool,
) -> dict[str, Any]:
    from transformers import DataCollatorForLanguageModeling, Trainer, TrainingArguments  # noqa: PLC0415

    try:
        from datasets import Dataset  # noqa: PLC0415
    except ImportError:
        sys.exit("ERROR: datasets is required. Install with: pip install datasets")

    def tokenize(examples: dict[str, list[str]]) -> dict[str, Any]:
        return tokenizer(
            examples["text"],
            max_length=max_length,
            truncation=True,
            padding="max_length",
        )

    dataset = Dataset.from_dict({"text": prompts})
    tokenized = dataset.map(tokenize, batched=True, remove_columns=["text"])

    training_args = TrainingArguments(
        output_dir=str(output_dir / "checkpoints"),
        num_train_epochs=epochs,
        per_device_train_batch_size=batch_size,
        learning_rate=lr,
        logging_steps=max(1, len(prompts) // (batch_size * 10)),
        save_strategy="epoch",
        report_to="none",
    )

    data_collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized,
        data_collator=data_collator,
    )

    train_result = trainer.train()
    return {
        "finalLoss": train_result.training_loss,
        "epochs": epochs,
        "totalSteps": train_result.global_step,
        "samplesPerSecond": train_result.metrics.get("train_samples_per_second"),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    _require("transformers", "pip install transformers")
    _require("accelerate", "pip install accelerate")

    args = _parse_args()
    output_root = Path(args.root)
    if not output_root.is_dir():
        sys.exit(f"ERROR: output root not found: {output_root}")

    if args.jsonl:
        jsonl_path = Path(args.jsonl)
    elif args.snapshot:
        jsonl_path = (
            output_root / "_system" / "ml" / "notagen-sft" / args.snapshot / "sft-pairs.jsonl"
        )
    else:
        sys.exit(
            "ERROR: provide --snapshot=<id> or --jsonl=<path>.\n"
            "Run 'npm run ml:export:notagen-sft' first to produce the JSONL dataset."
        )

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    out_dir = (
        Path(args.out)
        if args.out
        else output_root / "_system" / "ml" / "notagen-adapter" / run_id
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading SFT dataset: {jsonl_path}")
    prompts = _load_jsonl(jsonl_path, min_score=args.min_score, verbose=args.verbose)
    if not prompts:
        sys.exit(
            f"ERROR: no usable training pairs in {jsonl_path}.\n"
            "Ensure abcText and controlLines are present in proposalEvidence.\n"
            "Tip: use --include-mock to include mock-backend rows for testing."
        )

    print(f"Training on {len(prompts)} pairs (mode={args.mode}, model={args.model})")
    model, tokenizer = _load_model_and_tokenizer(
        args.model, args.mode, args.lora_r, args.lora_alpha,
    )

    metrics = _train(
        model, tokenizer, prompts,
        epochs=args.epochs,
        batch_size=args.batch_size,
        max_length=args.max_length,
        lr=args.lr,
        output_dir=out_dir,
        verbose=args.verbose,
    )

    adapter_dir = out_dir / "adapter_model"
    model.save_pretrained(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    print(f"Model saved to: {adapter_dir}")

    summary = {
        "runId": run_id,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "model": args.model,
        "mode": args.mode,
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "maxLength": args.max_length,
        "lr": args.lr,
        "loraR": args.lora_r if args.mode == "lora" else None,
        "loraAlpha": args.lora_alpha if args.mode == "lora" else None,
        "minScore": args.min_score,
        "trainingPairs": len(prompts),
        "jsonlPath": str(jsonl_path),
        "outputDir": str(out_dir),
        "metrics": metrics,
    }
    summary_path = out_dir / "run_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Run summary: {summary_path}")
    print(f"Final loss: {metrics['finalLoss']:.4f}")
    print("Done.")


if __name__ == "__main__":
    main()
