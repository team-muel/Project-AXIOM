"""Train a logistic-regression preference reranker from listener feedback.

Two data sources are supported:

1. JSONL mode (recommended): reads a preferences.jsonl file produced by
   ``npm run ml:export:notagen-preferences``.

   --snapshot=<id>  reads  outputs/_system/ml/notagen-preferences/<id>/preferences.jsonl
   --jsonl=<path>   reads an explicit JSONL path

2. Manifest scan mode (legacy): walks outputs/<song_id>/candidates/candidate-manifest.json
   (used when neither --snapshot nor --jsonl is given).

Label encoding
──────────────
  JSONL mode:    decision == "approved" → 1,  decision == "rejected" → 0
  Manifest mode: appeal >= 4 → 1,  appeal == 3 → excluded,  appeal <= 2 → 0

Features
────────
  Craft dimensions (8):
    syntaxValidity, sectionContractFit, cadenceStrength, tonalReturn,
    motifSurvival, voiceIndependence, phraseShape, registerIdiomaticFit
  Context features (6):
    normalizationWarningsCount  (int, clipped to [0, 10])
    sectionCount                (int, clipped to [1, 20])
    provider_notagen            (0/1)
    provider_other              (0/1)  [music21 → reference category]
    generationMode_mock         (0/1)
    generationMode_local        (0/1)  [template → reference category]

Snapshot output
───────────────
  outputs/_system/preference-reranker-snapshot.json
  (or --out=<path>)

Usage
─────
  # From latest export snapshot (recommended):
  python scripts/train-preference-reranker.py --snapshot=2025-05-15

  # From explicit JSONL path:
  python scripts/train-preference-reranker.py --jsonl=outputs/_system/ml/notagen-preferences/2025-05-15/preferences.jsonl

  # Legacy manifest scan:
  python scripts/train-preference-reranker.py [--root=outputs] [--out=<path>]
                                              [--min-samples=10] [--verbose]
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

def _require_sklearn() -> None:
    try:
        import sklearn  # noqa: F401
    except ImportError:
        sys.exit(
            "ERROR: scikit-learn is required. Install it with:\n"
            "  pip install scikit-learn\n"
        )


# ---------------------------------------------------------------------------
# CLI parsing
# ---------------------------------------------------------------------------

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Train a logistic-regression preference reranker from AXIOM listener feedback.",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    p.add_argument("--root", default="outputs",
                   help="AXIOM output directory (default: outputs)")
    p.add_argument("--out", default=None,
                   help="Snapshot output path (default: <root>/_system/preference-reranker-snapshot.json)")
    p.add_argument("--snapshot", default=None,
                   help="Snapshot ID produced by ml:export:notagen-preferences (e.g. 2025-05-15). "
                        "Reads <root>/_system/ml/notagen-preferences/<id>/preferences.jsonl")
    p.add_argument("--jsonl", default=None,
                   help="Explicit path to a preferences.jsonl file to use instead of manifest scanning.")
    p.add_argument("--min-samples", type=int, default=10,
                   help="Minimum labelled samples required to train (default: 10)")
    p.add_argument("--verbose", action="store_true",
                   help="Print debug diagnostics")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

CRAFT_DIMS = [
    "syntaxValidity",
    "sectionContractFit",
    "cadenceStrength",
    "tonalReturn",
    "motifSurvival",
    "voiceIndependence",
    "phraseShape",
    "registerIdiomaticFit",
]

FEATURE_NAMES = CRAFT_DIMS + [
    "normalizationWarningsCount",
    "sectionCount",
    "provider_notagen",
    "provider_other",
    "generationMode_mock",
    "generationMode_local",
]


def _safe_float(value: Any, fallback: float = 0.5) -> float:
    """Cast to float, return fallback on failure."""
    try:
        v = float(value)
        return v if -1e9 < v < 1e9 else fallback
    except (TypeError, ValueError):
        return fallback


def _provider_and_mode_features(provider: str, mode: str) -> list[float]:
    """Return the four provider/generationMode one-hot features."""
    provider = provider.lower()
    mode = mode.lower()
    return [
        1.0 if "notagen" in provider else 0.0,
        0.0 if ("notagen" in provider or "music21" in provider) else 1.0,
        1.0 if mode == "mock_notagen_abc" or mode.startswith("mock") else 0.0,
        1.0 if mode in ("notagen_local", "local") else 0.0,
    ]


def _extract_features(manifest: dict[str, Any]) -> list[float]:
    """Extract the feature vector from a candidate manifest dict (legacy manifest mode)."""
    craft = (
        manifest.get("structureEvaluation", {}) or {}
    ).get("craftScoreSummary") or {}
    internal = manifest.get("internalScores") or {}
    evidence = manifest.get("proposalEvidence") or {}
    comp_plan = manifest.get("compositionPlan") or {}

    feats: list[float] = []
    for dim in CRAFT_DIMS:
        v = craft.get(dim) if craft.get(dim) is not None else internal.get(dim)
        feats.append(_safe_float(v))

    warnings = evidence.get("normalizationWarnings") or []
    feats.append(float(min(len(warnings) if isinstance(warnings, list) else 0, 10)))

    sections = comp_plan.get("sections") or []
    feats.append(float(min(max(len(sections) if isinstance(sections, list) else 1, 1), 20)))

    provider = str(manifest.get("provider") or evidence.get("provider") or "")
    mode = str(evidence.get("generationMode") or "")
    feats.extend(_provider_and_mode_features(provider, mode))

    return feats


def _extract_features_from_jsonl_row(row: dict[str, Any]) -> list[float]:
    """Extract the feature vector from a preferences.jsonl row."""
    craft = row.get("craftScoreSummary") or {}
    evidence = row.get("proposalEvidence") or {}
    prompt_pack = row.get("promptPack") or {}

    feats: list[float] = []
    for dim in CRAFT_DIMS:
        feats.append(_safe_float(craft.get(dim)))

    warnings = evidence.get("normalizationWarnings") or []
    feats.append(float(min(len(warnings) if isinstance(warnings, list) else 0, 10)))

    sections = prompt_pack.get("sections") or []
    feats.append(float(min(max(len(sections) if isinstance(sections, list) else 1, 1), 20)))

    provider = str(evidence.get("provider") or "")
    mode = str(evidence.get("generationMode") or "")
    feats.extend(_provider_and_mode_features(provider, mode))

    return feats


# ---------------------------------------------------------------------------
# Dataset collection
# ---------------------------------------------------------------------------

def _collect_dataset_from_jsonl(
    jsonl_path: Path,
    verbose: bool = False,
) -> tuple[list[list[float]], list[int], dict[str, int]]:
    """Read labelled rows from a preferences.jsonl export file."""
    X: list[list[float]] = []
    y: list[int] = []
    stats = {"scanned": 0, "approved": 0, "rejected": 0, "excluded": 0, "no_feedback": 0}

    if not jsonl_path.is_file():
        sys.exit(f"ERROR: JSONL file not found: {jsonl_path}")

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

            stats["scanned"] += 1
            decision = str(row.get("decision") or "").lower()

            if decision == "approved":
                label = 1
                stats["approved"] += 1
            elif decision == "rejected":
                label = 0
                stats["rejected"] += 1
            else:
                stats["no_feedback"] += 1
                continue

            feats = _extract_features_from_jsonl_row(row)
            X.append(feats)
            y.append(label)
            if verbose:
                print(f"  [{row.get('songId', '?')}] decision={decision} → label={label}")

    return X, y, stats


def _collect_dataset(
    output_root: Path,
    verbose: bool = False,
) -> tuple[list[list[float]], list[int], dict[str, int]]:
    """Walk manifest files and return (X, y, stats).  Legacy manifest-scan mode."""
    X: list[list[float]] = []
    y: list[int] = []
    stats = {"scanned": 0, "approved": 0, "rejected": 0, "excluded": 0, "no_feedback": 0}

    for song_dir in sorted(output_root.iterdir()):
        if song_dir.name.startswith("_"):
            continue
        candidates_dir = song_dir / "candidates"
        if not candidates_dir.is_dir():
            continue
        for cand_dir in sorted(candidates_dir.iterdir()):
            manifest_path = cand_dir / "candidate-manifest.json"
            if not manifest_path.is_file():
                continue
            stats["scanned"] += 1
            try:
                manifest = json.loads(manifest_path.read_text("utf-8"))
            except Exception:
                continue

            feedback = manifest.get("listenerFeedback") or {}
            appeal = feedback.get("appeal")
            if not isinstance(appeal, (int, float)):
                stats["no_feedback"] += 1
                continue

            appeal = int(appeal)
            if appeal >= 4:
                label = 1
                stats["approved"] += 1
            elif appeal <= 2:
                label = 0
                stats["rejected"] += 1
            else:
                stats["excluded"] += 1
                continue

            feats = _extract_features(manifest)
            X.append(feats)
            y.append(label)
            if verbose:
                print(f"  [{cand_dir.name}] appeal={appeal} → label={label}")

    return X, y, stats


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def _train(
    X: list[list[float]],
    y: list[int],
    verbose: bool = False,
) -> dict[str, Any]:
    """Train logistic regression and return snapshot dict."""
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import StandardScaler

    X_arr = np.array(X, dtype=np.float64)
    y_arr = np.array(y, dtype=np.int32)

    # Standardize features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_arr)

    # Logistic regression with L2 regularization (safe for small datasets)
    clf = LogisticRegression(
        C=1.0,
        penalty="l2",
        solver="lbfgs",
        max_iter=500,
        class_weight="balanced",
        random_state=42,
    )

    # Cross-validation (only when enough samples for at least 3 folds)
    cv_accuracy: float | None = None
    n_samples = len(y_arr)
    if n_samples >= 6:
        n_folds = min(5, n_samples // 2)
        cv_scores = cross_val_score(clf, X_scaled, y_arr, cv=n_folds, scoring="accuracy")
        cv_accuracy = float(np.mean(cv_scores))
        if verbose:
            print(f"Cross-validation accuracy ({n_folds}-fold): {cv_accuracy:.3f} ± {float(np.std(cv_scores)):.3f}")

    clf.fit(X_scaled, y_arr)

    train_acc = float((clf.predict(X_scaled) == y_arr).mean())
    if verbose:
        print(f"Training accuracy: {train_acc:.3f}")
        print(f"Coefficients: {dict(zip(FEATURE_NAMES, clf.coef_[0].round(4).tolist()))}")

    # Store mean_ and scale_ so the TS side can reconstruct standardization
    return {
        "version": 1,
        "algorithm": "logistic_regression",
        "featureNames": FEATURE_NAMES,
        "scalerMean": scaler.mean_.tolist(),
        "scalerScale": scaler.scale_.tolist(),
        "coefficients": clf.coef_[0].tolist(),
        "intercept": float(clf.intercept_[0]),
        "threshold": 0.5,
        "crossValAccuracy": cv_accuracy,
        "trainAccuracy": train_acc,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    _require_sklearn()
    args = _parse_args()

    output_root = Path(args.root)
    if not output_root.is_dir():
        sys.exit(f"ERROR: output root not found: {output_root}")

    out_path = Path(args.out) if args.out else output_root / "_system" / "preference-reranker-snapshot.json"

    # Resolve data source
    if args.jsonl:
        jsonl_path = Path(args.jsonl)
        print(f"Reading preferences from JSONL: {jsonl_path}")
        X, y, stats = _collect_dataset_from_jsonl(jsonl_path, verbose=args.verbose)
        data_source = str(jsonl_path)
    elif args.snapshot:
        jsonl_path = output_root / "_system" / "ml" / "notagen-preferences" / args.snapshot / "preferences.jsonl"
        print(f"Reading preferences from snapshot '{args.snapshot}': {jsonl_path}")
        X, y, stats = _collect_dataset_from_jsonl(jsonl_path, verbose=args.verbose)
        data_source = str(jsonl_path)
    else:
        print(f"Scanning manifests in: {output_root}")
        X, y, stats = _collect_dataset(output_root, verbose=args.verbose)
        data_source = str(output_root)

    print(
        f"Dataset: {stats['scanned']} records scanned, "
        f"{len(y)} labelled ({stats['approved']} approved, {stats['rejected']} rejected), "
        f"{stats.get('excluded', 0)} excluded, "
        f"{stats.get('no_feedback', 0)} without feedback",
    )

    if len(y) < args.min_samples:
        sys.exit(
            f"ERROR: only {len(y)} labelled samples (min required: {args.min_samples}).\n"
            f"Collect more listener feedback before training.\n"
            f"Tip: use --min-samples={len(y)} to override for testing."
        )

    approved_count = sum(y)
    rejected_count = len(y) - approved_count
    if approved_count == 0 or rejected_count == 0:
        sys.exit(
            f"ERROR: need both approved and rejected samples (got approved={approved_count}, "
            f"rejected={rejected_count})."
        )

    print("Training logistic regression...")
    model_data = _train(X, y, verbose=args.verbose)

    snapshot_id = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snapshot = {
        **model_data,
        "snapshotId": snapshot_id,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "sampleCount": len(y),
        "approvedCount": approved_count,
        "rejectedCount": rejected_count,
        "dataSource": data_source,
        "notes": (
            f"Trained on {len(y)} labelled candidates from {data_source}. "
            f"Use AXIOM_PREFERENCE_RERANKER_SNAPSHOT to override path."
        ),
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    print(f"Snapshot written to: {out_path}")
    if model_data.get("crossValAccuracy") is not None:
        print(f"Cross-val accuracy: {model_data['crossValAccuracy']:.3f}")
    print("Done.")


if __name__ == "__main__":
    main()
