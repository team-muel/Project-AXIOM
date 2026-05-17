# Scoring Profiles

JSON config files that declare the dimension weights used by the craft evaluators,
and the threshold values used by the quality gates.

## Scoring weight profiles

| File | Profile ID | Evaluator |
|------|-----------|-----------|
| `classical_default_v1.json` | `classical_default_v1` | `computeCraftScoreSummary` → `finalCraftScore` |
| `piano_listenability_v1.json` | `piano_listenability_v1` | `computePianoListenabilityScore` |

Weight profiles use a `weights` key. All weights **must sum to exactly 1.00**
(±0.005 tolerance). `loadScoringProfile()` validates this at load time.

## Quality gate profiles

| File | Profile ID | Used by |
|------|-----------|---------|
| `quality_gate_v1.json` | `quality_gate_v1` | `craftScorePassesHardFilter`, `pianoPlayabilityGate` |

Gate profiles use a `thresholds` key. Each value is an independent minimum in [0, 1] —
they do **not** need to sum to any particular value. `loadQualityGateConfig()` validates
the range at load time.

## Profile versioning

To create a new profile, copy an existing JSON file, increment the version suffix, and adjust the values.
The profile name is stamped into:

- `CraftScoreSummary.scoringProfile` — set by `computeCraftScoreSummary()`
- `PianoListenabilityScoreBreakdown.scoringProfile` — set by `computePianoListenabilityScore()`
- `StructureCandidateManifest.scoringProfiles` — stored in candidate sidecar for reproducibility

This lets you compare runs: "this candidate was selected under `classical_default_v1` + `quality_gate_v1`."
