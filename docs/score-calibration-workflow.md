# Score Calibration Workflow

Human listener feedback is the ground truth for whether AXIOM's automated scores
actually predict what people want to hear.  This document describes how to run the
full calibration loop: collect feedback → measure correlations → generate a tuned
scoring profile.

---

## Prerequisites

- At least **3 rated candidates** (pairs of `internalScores` + human `appeal` rating).
  More candidates → more reliable correlation signal.
- Built dist: `npm run build`

---

## Step 1 — Generate candidates

Use the autonomy loop or the HTTP API to compose candidates normally.  Each
candidate lands under `outputs/<songId>/candidates/<candidateId>/candidate-manifest.json`.

```bash
# Start the server (if not already running)
npm start

# Trigger a composition
curl -X POST http://localhost:3000/compose \
  -H "Content-Type: application/json" \
  -d '{"workflow":"classical_symbolic","source":"calibration"}'
```

---

## Step 2 — Enter human feedback

Post listener ratings for **every** candidate you want calibrated — including
rejected ones.  Pairwise preference data is especially valuable.

```bash
# Rate a candidate (selected or rejected)
curl -X POST http://localhost:3000/feedback/<songId>/<candidateId> \
  -H "Content-Type: application/json" \
  -d '{
    "appeal": 4,
    "coherence": 3,
    "memorability": 5,
    "emotionalImpact": 4,
    "preferredOver": "<otherCandidateId>",
    "rejectionReason": "melody is too repetitive"
  }'
```

**Fields:**
| Field | Type | Notes |
|---|---|---|
| `appeal` | 1–5 | **Required** — overall preference |
| `coherence` | 1–5 | Optional |
| `memorability` | 1–5 | Optional |
| `emotionalImpact` | 1–5 | Optional |
| `preferredOver` | candidateId | Optional — pairwise signal |
| `rejectionReason` | string | Optional — free text |

---

## Step 3 — Run correlation analysis

```bash
npm run analyze:score-feedback
```

This runs `scripts/analyze-score-feedback-correlation.mjs` and writes:

| Output | Location |
|---|---|
| JSON report | `outputs/_system/score-feedback-correlation.json` |
| CSV table | `outputs/_system/score-feedback-correlation.csv` |

**What the report contains:**

```json
{
  "dimensions": [
    {
      "scoreDimension": "finalCraftScore",
      "feedbackDimension": "appeal",
      "pearsonR": 0.72,
      "n": 14,
      "signal": "strong"
    },
    {
      "scoreDimension": "planAwareMotifDevelopmentScore",
      "feedbackDimension": "appeal",
      "pearsonR": 0.18,
      "n": 14,
      "signal": "weak"
    }
  ]
}
```

---

## Step 4 — Generate a tuned scoring profile

```bash
node scripts/create-score-profile-from-correlation.mjs \
  --input=outputs/_system/score-feedback-correlation.json \
  --name=classical_default_v2 \
  --output=config/scoring-profiles/classical_default_v2.json \
  --base=classical_default_v1
```

**Options:**
| Flag | Default | Notes |
|---|---|---|
| `--input` | `outputs/_system/score-feedback-correlation.json` | Correlation JSON |
| `--name` | required | New profile identifier |
| `--output` | `config/scoring-profiles/<name>.json` | Output path |
| `--base` | `classical_default_v1` | Base profile to start from |
| `--feedback-dim` | `appeal` | Feedback dimension to calibrate against |
| `--min-r` | `0.15` | Minimum |r| to include a dimension in weight adjustment |
| `--min-n` | `3` | Minimum sample size |

The script:
1. Loads base profile weights
2. For each dimension that has a correlation above `--min-r`, scales the weight
   proportionally to `max(0, r)` (positive correlation → weight preserved/boosted;
   negative correlation → weight reduced to near zero)
3. Re-normalises weights to sum to 1.00
4. Writes a new JSON profile file with `status: "experimental"`

---

## Step 5 — Activate the new profile

```bash
# .env or environment
AXIOM_SCORING_PROFILE=classical_default_v2
```

The runtime profile registry (`src/core/evaluate/scoringProfileRegistry.ts`) will:
1. Check `AXIOM_SCORING_PROFILE` env var
2. Look up `config/scoring-profiles/classical_default_v2.json`
3. Validate weights (must sum to 1.00 ± 0.005)
4. Cache and use for all subsequent evaluations

---

## Step 6 — Verify improvement

Re-run the correlation analysis after collecting feedback on the new profile's
candidates.  If `pearsonR` for `finalCraftScore → appeal` increases, the
calibration is working.

```bash
npm run analyze:score-feedback
```

Compare `outputs/_system/score-feedback-correlation.json` before and after.

---

## Example: full calibration cycle

```
1. npm start
2. Compose 10+ candidates via /compose
3. Rate all candidates via /feedback/:songId/:candidateId
4. npm run analyze:score-feedback
5. node scripts/create-score-profile-from-correlation.mjs \
     --name=classical_default_v2 --base=classical_default_v1
6. AXIOM_SCORING_PROFILE=classical_default_v2 npm start
7. Compose 10+ more candidates, rate them
8. npm run analyze:score-feedback   ← compare to step 4
```

---

## Interpreting correlation signal

| |r| range | Signal | Recommendation |
|---|---|---|
| ≥ 0.6 | Strong | Keep or boost weight |
| 0.3–0.6 | Moderate | Keep weight as-is |
| 0.15–0.3 | Weak | Consider reducing weight |
| < 0.15 | Noise | Reduce to near-zero or remove |
| Negative | Anti-correlated | Investigate — possible metric inversion |

**Important caveats:**
- Correlation does not imply causation.  A dimension may correlate because it
  co-varies with a genuinely important dimension.
- Minimum 10 rated candidates per feedback dimension for reliable estimates.
- Piano candidates should be calibrated with `piano_listenability_v1` as the base
  profile, not `classical_default_v1`.

---

## Profile file format

```json
{
  "profile": "classical_default_v2",
  "status": "experimental",
  "description": "Calibrated from correlation analysis on 2026-05-19 (14 samples).",
  "weights": {
    "sectionContractFit":   0.18,
    "cadenceStrength":      0.20,
    "tonalReturn":          0.16,
    "motifSurvival":        0.14,
    "voiceIndependence":    0.12,
    "phraseShape":          0.10,
    "registerIdiomaticFit": 0.07,
    "syntaxValidity":       0.03
  }
}
```

Place the file in `config/scoring-profiles/` and set the env var to activate it.
