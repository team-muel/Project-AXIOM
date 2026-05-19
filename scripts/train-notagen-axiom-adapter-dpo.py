"""Train an AXIOM-critic DPO preference adapter for NotaGen-class models.

Stage 3 of the AXIOM NotaGen learning loop:

  Stage 1 (current):  NotaGen native → 8-32 candidates → AXIOM craft scoring + reranking
  Stage 2:            SFT fine-tune with accepted candidates (train-notagen-axiom-adapter.py)
  Stage 3 (this):     DPO fine-tune on (chosen, rejected) pairs from AXIOM internal critic
  Stage 4:            Re-run same piece types and compare ablation scores

The AXIOM Learning Loop (closed)
---------------------------------
  1. AXIOM designs structure: form, key, phrase plan, harmony plan, motif graph, piano plan
  2. NotaGen generates 8-32 candidates
  3. AXIOM internal critic evaluates: phrase, harmony, motif, cadence, piano listenability, coverage
  4. Accepted candidates  → outputs/_system/ml/notagen-sft/<snapshot>/sft-pairs.jsonl (SFT source)
  5. Hard negatives       → outputs/_system/ml/notagen-preferences/<snapshot>/dpo-critic-pairs.jsonl
       failure types: harmony failure / motif recap failure / piano listenability failure / evidence insufficient
  6a. SFT: python scripts/train-notagen-axiom-adapter.py  --snapshot=<id>
  6b. DPO: python scripts/train-notagen-axiom-adapter-dpo.py --snapshot=<id>   ← this script
  7. Run same piece types again and compare:
       node --test test/benchmark-notagen-control-ablation.test.mjs

DPO Pair Format
---------------
Input JSONL from export-notagen-preference-dataset.mjs:
  {
    "chosen":   { "instruction": "...", "response": "..." },
    "rejected": { "instruction": "...", "response": "..." },
    "meta": {
      "planSignature": "...",
      "rejectionReason": "harmony_failure" | "motif_recap_failure"
                       | "piano_listenability_failure" | "evidence_insufficient",
      "scoreGap": 0.15,
      "craftScores": { "finalCraftScore": 0.72, ... }
    }
  }

Training Method
---------------
Implements a minimal DPO training loop compatible with standard HF causal LMs.
Reference: Rafailov et al. 2023 — "Direct Preference Optimization: Your Language Model
is Secretly a Reward Model"

  L_DPO = -E[ log sigma( beta * ( log pi(y_w|x)/pi_ref(y_w|x)
                                 - log pi(y_l|x)/pi_ref(y_l|x) ) ) ]

For LoRA DPO:
  - The LoRA adapter IS the policy being trained.
  - The frozen base model (no adapter) serves as the reference policy.
  - No separate reference model checkpoint needed.

Prerequisites
-------------
  pip install transformers datasets accelerate
  pip install peft   # required for --mode=lora (strongly recommended)

Usage
-----
  # DPO from latest export snapshot (after SFT adapter is ready):
  python scripts/train-notagen-axiom-adapter-dpo.py \\
      --snapshot=2025-05-15 --sft-adapter=outputs/_system/ml/notagen-adapter/<run-id>/adapter_model

  # DPO with explicit JSONL path:
  python scripts/train-notagen-axiom-adapter-dpo.py \\
      --jsonl=outputs/_system/ml/notagen-preferences/2025-05-15/dpo-critic-pairs.jsonl \\
      --sft-adapter=outputs/_system/ml/notagen-adapter/<run-id>/adapter_model

  # LoRA DPO (GPU recommended, VRAM >= 8GB):
  python scripts/train-notagen-axiom-adapter-dpo.py \\
      --snapshot=2025-05-15 --mode=lora \\
      --sft-adapter=outputs/_system/ml/notagen-adapter/<run-id>/adapter_model \\
      --beta=0.1

Output
------
  outputs/_system/ml/notagen-dpo-adapter/<run-id>/
    adapter_model/   -- DPO-trained model / LoRA adapter weights
    run_summary.json -- loss curve, dataset stats, rejection reason breakdown

Notes on rejection_reason stratification
-----------------------------------------
  The DPO trainer logs per-rejection-reason loss breakdown to run_summary.json.
  If "harmony_failure" pairs have higher loss than "motif_recap_failure" pairs,
  the model is learning harmony avoidance faster — useful for curriculum planning.

Notes on NotaGen native
-----------------------
  Native NotaGen uses a custom hierarchical decoder incompatible with HF AutoModelForCausalLM.
  This script targets HF-compatible causal LMs (hf_causal_lm path).
  For native NotaGen DPO, adapt the NotaGen training loop from the official repo
  (https://github.com/ElectricAlexis/NotaGen) using the JSONL exported here as data.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
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
        description="DPO fine-tune a HF causal LM using AXIOM-critic preference pairs.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    p.add_argument("--root", default="outputs",
                   help="AXIOM output directory (default: outputs)")
    p.add_argument("--snapshot", default=None,
                   help="DPO snapshot ID from export:notagen-dpo (e.g. 2025-05-15)")
    p.add_argument("--jsonl", default=None,
                   help="Explicit path to dpo-critic-pairs.jsonl (overrides --snapshot)")
    p.add_argument("--sft-adapter", default=None,
                   help="Path to SFT adapter checkpoint to initialize from "
                        "(recommended: use Stage 2 SFT adapter as starting point).\n"
                        "If omitted, initializes from --model base checkpoint directly.")
    p.add_argument("--model", default="EleutherAI/gpt-neo-125M",
                   help="HuggingFace model id or local path (default: EleutherAI/gpt-neo-125M).\n"
                        "Ignored when --sft-adapter is provided (model is inferred from adapter).")
    p.add_argument("--mode", choices=["lora", "full"], default="lora",
                   help="Training mode: lora=LoRA DPO (default, GPU recommended), full=full DPO")
    p.add_argument("--epochs", type=int, default=2,
                   help="Training epochs (default: 2; DPO requires fewer epochs than SFT)")
    p.add_argument("--batch-size", type=int, default=2,
                   help="Per-device training batch size (default: 2; DPO uses more memory than SFT)")
    p.add_argument("--max-length", type=int, default=1024,
                   help="Max token length for prompt+completion (default: 1024)")
    p.add_argument("--lr", type=float, default=1e-5,
                   help="Learning rate (default: 1e-5; DPO uses lower lr than SFT)")
    p.add_argument("--beta", type=float, default=0.1,
                   help="DPO beta — KL penalty weight (default: 0.1; higher=stay closer to ref)")
    p.add_argument("--lora-r", type=int, default=16,
                   help="LoRA rank (default: 16)")
    p.add_argument("--lora-alpha", type=int, default=32,
                   help="LoRA alpha (default: 32)")
    p.add_argument("--min-score-gap", type=float, default=0.05,
                   help="Exclude pairs where scoreGap < this (default: 0.05)")
    p.add_argument("--rejection-reasons", default=None,
                   help="Comma-separated list of rejection reasons to include.\n"
                        "Options: harmony_failure,motif_recap_failure,piano_listenability_failure,"
                        "evidence_insufficient,low_craft_score\n"
                        "Default: all reasons included.")
    p.add_argument("--out", default=None,
                   help="Output directory override")
    p.add_argument("--verbose", action="store_true")
    p.add_argument("--dry-run", action="store_true",
                   help="Load and validate dataset; print stats without training")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

# Rejection reasons produced by export-notagen-preference-dataset.mjs
KNOWN_REJECTION_REASONS = frozenset({
    "harmony_failure",
    "motif_recap_failure",
    "piano_listenability_failure",
    "evidence_insufficient",
    "low_craft_score",
})


def _safe_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed and parsed not in (float("inf"), float("-inf")) else None


def _response_text(side: dict[str, Any]) -> str:
    """Read current DPO rows (`response`) and older export rows (`output`)."""
    return str(side.get("response") or side.get("output") or "").strip()


def _infer_score_gap(row: dict[str, Any]) -> float:
    meta = row.get("meta") or {}
    explicit_gap = _safe_float(meta.get("scoreGap"))
    if explicit_gap is not None:
        return explicit_gap

    chosen_scores = ((row.get("chosen") or {}).get("scores") or {})
    rejected_scores = ((row.get("rejected") or {}).get("scores") or {})
    gaps = [
        (_safe_float(chosen_scores.get(key)) or 0.0) - (_safe_float(rejected_scores.get(key)) or 0.0)
        for key in (
            "finalCraftScore",
            "advancedCraftScore",
            "harmonyContractScore",
            "evidenceCoverageScore",
            "pianoListenabilityScore",
        )
    ]
    return max(0.0, *gaps)


def _infer_rejection_reason(row: dict[str, Any]) -> str:
    meta = row.get("meta") or {}
    explicit_reason = str(meta.get("rejectionReason") or "").strip()
    if explicit_reason:
        return explicit_reason

    rejected = row.get("rejected") or {}
    failed_gates = " ".join(str(g) for g in rejected.get("failedGates") or [])
    rejected_scores = rejected.get("scores") or {}
    if "harmony" in failed_gates or (_safe_float(rejected_scores.get("harmonyContractViolations")) or 0) > 0:
        return "harmony_failure"
    if (_safe_float(rejected_scores.get("motifReturnScore")) or 1.0) <= 0.30:
        return "motif_recap_failure"
    if "piano" in failed_gates:
        return "piano_listenability_failure"
    if "evidence" in failed_gates or rejected_scores.get("evidenceCoverageGateTier") in {"partial", "none"}:
        return "evidence_insufficient"
    return "low_craft_score"


def _load_dpo_pairs(
    jsonl_path: Path,
    min_score_gap: float = 0.05,
    allowed_reasons: set[str] | None = None,
    verbose: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Load and filter DPO pairs; return list of {chosen, rejected, meta} dicts."""
    if not jsonl_path.is_file():
        sys.exit(f"ERROR: DPO JSONL not found: {jsonl_path}")

    pairs: list[dict[str, Any]] = []
    skipped = 0
    reason_counts: dict[str, int] = defaultdict(int)

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
                skipped += 1
                continue

            chosen = row.get("chosen") or {}
            rejected = row.get("rejected") or {}

            chosen_instruction = str(chosen.get("instruction") or "").strip()
            chosen_response = _response_text(chosen)
            rejected_instruction = str(rejected.get("instruction") or "").strip()
            rejected_response = _response_text(rejected)

            if not all([chosen_instruction, chosen_response, rejected_instruction, rejected_response]):
                skipped += 1
                continue

            score_gap = _infer_score_gap(row)
            if score_gap < min_score_gap:
                skipped += 1
                continue

            rejection_reason = _infer_rejection_reason(row)
            if allowed_reasons and rejection_reason not in allowed_reasons:
                skipped += 1
                continue

            reason_counts[rejection_reason or "unknown"] += 1
            pairs.append({
                "chosen_instruction":  chosen_instruction,
                "chosen_response":     chosen_response,
                "rejected_instruction": rejected_instruction,
                "rejected_response":   rejected_response,
                "meta": {
                    **(row.get("meta") or {}),
                    "scoreGap": score_gap,
                    "rejectionReason": rejection_reason,
                },
            })

    if verbose:
        print(f"  Loaded {len(pairs)} DPO pairs, skipped {skipped}")
        print(f"  Rejection reason breakdown: {dict(reason_counts)}")

    return pairs, dict(reason_counts)


# ---------------------------------------------------------------------------
# Prompt formatting
# ---------------------------------------------------------------------------

def _build_prompt(instruction: str, response: str) -> str:
    """Alpaca-style prompt — must match SFT training format exactly."""
    return f"### Instruction:\n{instruction}\n\n### Response:\n{response}"


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def _load_model_and_tokenizer(
    model_name_or_path: str,
    sft_adapter_path: str | None,
    mode: str,
    lora_r: int,
    lora_alpha: int,
) -> tuple[Any, Any]:
    from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: PLC0415  # type: ignore[import]

    # When SFT adapter is provided, load base model first, then apply adapter
    base_model_path = model_name_or_path

    if sft_adapter_path:
        # Try to read base model name from adapter config
        adapter_config_path = Path(sft_adapter_path) / "adapter_config.json"
        if adapter_config_path.is_file():
            with adapter_config_path.open() as f:
                adapter_cfg = json.load(f)
            base_model_path = adapter_cfg.get("base_model_name_or_path", model_name_or_path)
            print(f"Inferred base model from SFT adapter: {base_model_path}")

    print(f"Loading tokenizer: {base_model_path}")
    tokenizer = AutoTokenizer.from_pretrained(
        sft_adapter_path if sft_adapter_path else base_model_path,
        local_files_only=bool(sft_adapter_path),
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print(f"Loading base model: {base_model_path}")
    model = AutoModelForCausalLM.from_pretrained(base_model_path)

    if sft_adapter_path:
        _require("peft", "pip install peft")
        from peft import PeftModel  # noqa: PLC0415  # type: ignore[import]
        print(f"Loading SFT adapter: {sft_adapter_path}")
        model = PeftModel.from_pretrained(model, sft_adapter_path, is_trainable=True)
    elif mode == "lora":
        _require("peft", "pip install peft")
        from peft import LoraConfig, TaskType, get_peft_model  # noqa: PLC0415  # type: ignore[import]
        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=lora_r,
            lora_alpha=lora_alpha,
            lora_dropout=0.05,
            bias="none",
            target_modules=["c_attn", "c_proj", "q_proj", "v_proj"],
        )
        model = get_peft_model(model, lora_config)

    if hasattr(model, "print_trainable_parameters"):
        model.print_trainable_parameters()

    return model, tokenizer


# ---------------------------------------------------------------------------
# DPO loss computation
# ---------------------------------------------------------------------------

def _compute_log_probs(model: Any, input_ids: Any, labels: Any) -> Any:
    """Compute per-token log probabilities for a sequence batch."""
    import torch  # noqa: PLC0415  # type: ignore[import]
    with torch.no_grad() if not model.training else torch.enable_grad():  # type: ignore[attr-defined]
        outputs = model(input_ids=input_ids, labels=labels)
    # Return negative loss as log-likelihood proxy (summed over non-masked tokens)
    return -outputs.loss


def _dpo_loss(
    policy_model: Any,
    ref_log_prob_chosen: float,
    ref_log_prob_rejected: float,
    chosen_ids: Any,
    rejected_ids: Any,
    chosen_labels: Any,
    rejected_labels: Any,
    beta: float,
) -> Any:
    """
    Minimal DPO loss for a single (chosen, rejected) pair.
    L = -log sigmoid(beta * (log pi(y_w|x)/pi_ref(y_w|x) - log pi(y_l|x)/pi_ref(y_l|x)))
    """
    import torch  # noqa: PLC0415  # type: ignore[import]
    import torch.nn.functional as F  # noqa: PLC0415  # type: ignore[import]

    policy_log_prob_chosen   = _compute_log_probs(policy_model, chosen_ids,   chosen_labels)
    policy_log_prob_rejected = _compute_log_probs(policy_model, rejected_ids, rejected_labels)

    # DPO implicit reward difference
    reward_diff = beta * (
        (policy_log_prob_chosen   - ref_log_prob_chosen) -
        (policy_log_prob_rejected - ref_log_prob_rejected)
    )

    return -F.logsigmoid(reward_diff)


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def _train_dpo(
    model: Any,
    tokenizer: Any,
    pairs: list[dict[str, Any]],
    *,
    epochs: int,
    batch_size: int,
    max_length: int,
    lr: float,
    beta: float,
    output_dir: Path,
    verbose: bool,
) -> dict[str, Any]:
    """
    Minimal DPO training loop.

    For LoRA: the frozen base model serves as reference policy (adapter disabled).
    For full fine-tuning: reference log-probs are computed before training begins.

    Note: For production training with large datasets (> 10k pairs),
    use TRL DPOTrainer (pip install trl) which is more memory-efficient and
    supports gradient accumulation, mixed precision, and multi-GPU.
    This implementation prioritizes clarity and correctness over throughput.
    """
    import torch  # noqa: PLC0415  # type: ignore[import]

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = model.to(device)
    model.train()

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr)

    def _tokenize_pair(instruction: str, response: str) -> tuple[Any, Any]:
        text = _build_prompt(instruction, response)
        enc = tokenizer(
            text, max_length=max_length, truncation=True,
            return_tensors="pt", padding="max_length",
        )
        input_ids = enc["input_ids"].to(device)
        # Labels: -100 for prompt tokens (only train on response)
        prompt_text = f"### Instruction:\n{instruction}\n\n### Response:\n"
        prompt_enc = tokenizer(prompt_text, return_tensors="pt")
        prompt_len = prompt_enc["input_ids"].shape[1]
        labels = input_ids.clone()
        labels[0, :prompt_len] = -100
        return input_ids, labels

    # Pre-compute reference log-probs (frozen model)
    print("Computing reference log-probabilities (frozen model)...")
    ref_log_probs_chosen:   list[float] = []
    ref_log_probs_rejected: list[float] = []

    model.eval()
    # For LoRA: disable adapter to get reference policy
    _has_peft = hasattr(model, "disable_adapter")
    with torch.no_grad():
        for pair in pairs:
            if _has_peft:
                with model.disable_adapter():
                    c_ids, c_labels = _tokenize_pair(pair["chosen_instruction"],   pair["chosen_response"])
                    r_ids, r_labels = _tokenize_pair(pair["rejected_instruction"], pair["rejected_response"])
                    ref_log_probs_chosen.append(float(_compute_log_probs(model, c_ids, c_labels)))
                    ref_log_probs_rejected.append(float(_compute_log_probs(model, r_ids, r_labels)))
            else:
                c_ids, c_labels = _tokenize_pair(pair["chosen_instruction"],   pair["chosen_response"])
                r_ids, r_labels = _tokenize_pair(pair["rejected_instruction"], pair["rejected_response"])
                ref_log_probs_chosen.append(float(_compute_log_probs(model, c_ids, c_labels)))
                ref_log_probs_rejected.append(float(_compute_log_probs(model, r_ids, r_labels)))

    print(f"Reference log-probs computed for {len(pairs)} pairs.")
    model.train()

    all_losses: list[float] = []
    reason_loss_sums: dict[str, float] = defaultdict(float)
    reason_loss_counts: dict[str, int] = defaultdict(int)
    step = 0

    for epoch in range(1, epochs + 1):
        epoch_loss = 0.0
        epoch_steps = 0

        for i in range(0, len(pairs), batch_size):
            batch = pairs[i : i + batch_size]
            batch_loss = torch.tensor(0.0, device=device, requires_grad=True)

            for j, pair in enumerate(batch):
                idx = i + j
                c_ids, c_labels = _tokenize_pair(pair["chosen_instruction"],   pair["chosen_response"])
                r_ids, r_labels = _tokenize_pair(pair["rejected_instruction"], pair["rejected_response"])

                loss = _dpo_loss(
                    model,
                    ref_log_probs_chosen[idx],
                    ref_log_probs_rejected[idx],
                    c_ids, r_ids, c_labels, r_labels,
                    beta=beta,
                )
                reason = str((pair.get("meta") or {}).get("rejectionReason") or "unknown")
                reason_loss_sums[reason] += float(loss.detach().item())
                reason_loss_counts[reason] += 1
                batch_loss = batch_loss + loss / len(batch)

            optimizer.zero_grad()
            batch_loss.backward()
            optimizer.step()

            loss_val = float(batch_loss.item())
            epoch_loss += loss_val
            epoch_steps += 1
            step += 1
            all_losses.append(loss_val)

            if verbose and step % 10 == 0:
                print(f"  epoch {epoch} step {step}: loss={loss_val:.4f}")

        avg_epoch_loss = epoch_loss / max(1, epoch_steps)
        print(f"Epoch {epoch}/{epochs} — avg DPO loss: {avg_epoch_loss:.4f}")

    return {
        "finalLoss": all_losses[-1] if all_losses else None,
        "avgLoss": sum(all_losses) / len(all_losses) if all_losses else None,
        "epochs": epochs,
        "totalSteps": step,
        "lossHistory": all_losses[::max(1, len(all_losses) // 50)],  # Downsampled for summary
        "lossByRejectionReason": {
            reason: reason_loss_sums[reason] / reason_loss_counts[reason]
            for reason in sorted(reason_loss_counts)
        },
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

    # Resolve DPO JSONL path
    if args.jsonl:
        jsonl_path = Path(args.jsonl)
    elif args.snapshot:
        jsonl_path = (
            output_root / "_system" / "ml" / "notagen-preferences"
            / args.snapshot / "dpo-critic-pairs.jsonl"
        )
    else:
        sys.exit(
            "ERROR: provide --snapshot=<id> or --jsonl=<path>.\n"
            "Run 'npm run export:notagen-dpo' first to produce the JSONL dataset."
        )

    # Parse allowed rejection reasons filter
    allowed_reasons: set[str] | None = None
    if args.rejection_reasons:
        allowed_reasons = set(r.strip() for r in args.rejection_reasons.split(","))
        unknown = allowed_reasons - KNOWN_REJECTION_REASONS
        if unknown:
            print(f"WARNING: unknown rejection reasons: {unknown}")
            print(f"  Known reasons: {sorted(KNOWN_REJECTION_REASONS)}")

    print(f"Loading DPO dataset: {jsonl_path}")
    pairs, reason_counts = _load_dpo_pairs(
        jsonl_path,
        min_score_gap=args.min_score_gap,
        allowed_reasons=allowed_reasons,
        verbose=True,
    )

    if not pairs:
        sys.exit(
            f"ERROR: no usable DPO pairs in {jsonl_path}.\n"
            "Ensure chosen and rejected candidates have instruction + response.\n"
            "Tip: run 'npm run export:notagen-dpo' to regenerate the dataset."
        )

    print(f"\nDPO dataset: {len(pairs)} pairs")
    print(f"Rejection reason breakdown: {reason_counts}")

    if args.dry_run:
        print("\n[dry-run] Dataset validated. Training skipped.")
        return

    # Resolve output directory
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    out_dir = (
        Path(args.out)
        if args.out
        else output_root / "_system" / "ml" / "notagen-dpo-adapter" / run_id
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    # Load model
    model_name = args.model
    print(f"\nInitializing model (mode={args.mode})...")
    model, tokenizer = _load_model_and_tokenizer(
        model_name, args.sft_adapter, args.mode, args.lora_r, args.lora_alpha,
    )

    # Train
    print(f"\nTraining DPO adapter ({len(pairs)} pairs, beta={args.beta}, lr={args.lr})...")
    metrics = _train_dpo(
        model, tokenizer, pairs,
        epochs=args.epochs,
        batch_size=args.batch_size,
        max_length=args.max_length,
        lr=args.lr,
        beta=args.beta,
        output_dir=out_dir,
        verbose=args.verbose,
    )

    # Save adapter
    adapter_dir = out_dir / "adapter_model"
    model.save_pretrained(str(adapter_dir))
    tokenizer.save_pretrained(str(adapter_dir))
    print(f"\nDPO adapter saved to: {adapter_dir}")

    # Save run summary
    summary = {
        "runId": run_id,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "stage": "dpo",
        "model": model_name,
        "sftAdapter": args.sft_adapter,
        "mode": args.mode,
        "epochs": args.epochs,
        "batchSize": args.batch_size,
        "maxLength": args.max_length,
        "lr": args.lr,
        "beta": args.beta,
        "loraR": args.lora_r,
        "loraAlpha": args.lora_alpha,
        "minScoreGap": args.min_score_gap,
        "allowedRejectionReasons": sorted(allowed_reasons) if allowed_reasons else "all",
        "datasetPath": str(jsonl_path),
        "numPairs": len(pairs),
        "rejectionReasonBreakdown": reason_counts,
        "outputDir": str(out_dir),
        **metrics,
    }
    summary_path = out_dir / "run_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Run summary saved to: {summary_path}")

    print("\nNext step: validate with ablation benchmark")
    print("  node --test test/benchmark-notagen-control-ablation.test.mjs")


if __name__ == "__main__":
    main()
