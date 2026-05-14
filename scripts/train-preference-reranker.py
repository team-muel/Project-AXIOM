"""Train a logistic-regression preference reranker from listener feedback.

Reads all candidate-manifest.json files under <output_root>/<song_id>/candidates/
to build a labelled dataset, then trains a logistic regression model and writes a
snapshot JSON that preferenceModel.ts can load at runtime.

Label encoding
──────────────
  appeal >= 4  → approved  (1)
  appeal == 3  → excluded  (ambiguous, skipped)
  appeal <= 2  → rejected  (0)

Features
────────
  Craft dimensions (8):
    syntaxValidity, sectionContractFit, cadenceStrength, tonalReturn,
    motifSurvival, voiceIndependence, phraseShape, registerIdiomaticFit
  Context features (4):
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
  python scripts/train-preference-reranker.py [--root=outputs] [--out=<path>]
                                              [--min-samples=10] [--verbose]
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
    p.add_argument("--min-samples", type=int, default=10,
                   help="Minimum labelled samples required to train (default: 10)")
    p.add_argument("--verbose", action="store_true",
                   help="Print debug diagnostics")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Manifest scanning
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


def _extract_features(manifest: dict[str, Any]) -> list[float]:
    """Extract the feature vector from a candidate manifest dict."""
    craft = (
        manifest.get("structureEvaluation", {}) or {}
    ).get("craftScoreSummary") or {}
    internal = manifest.get("internalScores") or {}
    evidence = manifest.get("proposalEvidence") or {}
    comp_plan = manifest.get("compositionPlan") or {}

    # Craft dimensions – prefer craftScoreSummary, fall back to internalScores
    feats: list[float] = []
    for dim in CRAFT_DIMS:
        v = craft.get(dim) if craft.get(dim) is not None else internal.get(dim)
        feats.append(_safe_float(v))

    # normalizationWarningsCount
    warnings = evidence.get("normalizationWarnings") or []
    warnings_count = float(min(len(warnings) if isinstance(warnings, list) else 0, 10))
    feats.append(warnings_count)

    # sectionCount
    sections = comp_plan.get("sections") or []
    section_count = float(min(max(len(sections) if isinstance(sections, list) else 1, 1), 20))
    feats.append(section_count)

    # provider one-hot: notagen / other  (music21 → reference category = [0,0])
    provider = str(manifest.get("provider") or evidence.get("provider") or "").lower()
    feats.append(1.0 if "notagen" in provider else 0.0)
    feats.append(0.0 if ("notagen" in provider or "music21" in provider) else 1.0)

    # generationMode one-hot: mock / local  (template → reference = [0,0])
    mode = str(evidence.get("generationMode") or "").lower()
    feats.append(1.0 if mode == "mock_notagen_abc" or mode.startswith("mock") else 0.0)
    feats.append(1.0 if mode == "notagen_local" or mode == "local" else 0.0)

    return feats


def _collect_dataset(
    output_root: Path,
    verbose: bool = False,
) -> tuple[list[list[float]], list[int], dict[str, int]]:
    """Walk manifest files and return (X, y, stats)."""
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
                # appeal == 3: ambiguous, skip
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

    print(f"Scanning manifests in: {output_root}")
    X, y, stats = _collect_dataset(output_root, verbose=args.verbose)

    print(
        f"Dataset: {stats['scanned']} manifests scanned, "
        f"{len(y)} labelled ({stats['approved']} approved, {stats['rejected']} rejected), "
        f"{stats['excluded']} excluded (appeal=3), "
        f"{stats['no_feedback']} without feedback",
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

    import hashlib
    snapshot_id = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snapshot = {
        **model_data,
        "snapshotId": snapshot_id,
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "sampleCount": len(y),
        "approvedCount": approved_count,
        "rejectedCount": rejected_count,
        "notes": (
            f"Trained on {len(y)} labelled candidates. "
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
