# Scoring Profiles

JSON config files that declare the dimension weights used by the craft evaluators.

| File | Profile ID | Evaluator |
|------|-----------|-----------|
| `classical_default_v1.json` | `classical_default_v1` | `computeCraftScoreSummary` → `finalCraftScore` |
| `piano_listenability_v1.json` | `piano_listenability_v1` | `computePianoListenabilityScore` |

## Versioning

To create a new profile, copy an existing JSON file, increment the version suffix, and adjust the weights.
The profile name is stamped into `CraftScoreSummary.scoringProfile` and `PianoListenabilityScoreBreakdown.scoringProfile` so results from different runs are always comparable.

## Constraint

All weights in a profile **must sum to exactly 1.00**.
`loadScoringProfile()` validates this at load time and throws if the sum is outside ±0.005.
