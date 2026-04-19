# Learned Backbone Stage A Manifest Review R02 Support

- review_sheet: outputs/_system/ml/review-manifests/learned-backbone/2026-04-19-stage-a-post-supplemental-manifest-r02/review-sheet.csv
- purpose: make the 11 pending manifest reviews executable without more artifact hunting
- lane: string_trio_symbolic
- benchmark_pack_version: string_trio_symbolic_benchmark_pack_v1

## How To Fill The Review Sheet

1. `approvalStatus`: use `approved` or `rejected`.
2. `appealScore`: use a simple numeric appeal score when the result is musically meaningful enough to rank.
3. `strongestDimension` and `weakestDimension`: use short musical phrases, not paragraphs.
4. `comparisonReference`: use the relevant blind pack id or another concrete comparison anchor if it informed the decision.
5. `note`: keep one sentence and make it discriminative.

Example vocabulary already used by tests: `cadence clarity`, `opening color`, `inner voice`, `rewrite stability`.

## Benchmark Review Focus

### cadence_clarity_reference

Listen for a calm opening and a clearly landed cadence. Strongest or weakest labels that fit this benchmark include `cadence clarity`, `opening calm`, `arrival strength`, `bass support`, `ending stability`.

### counterline_dialogue_probe

Listen for real trio dialogue, phrase contrast, and role separation rather than a single lead over accompaniment. Strongest or weakest labels that fit this benchmark include `counterline dialogue`, `phrase contrast`, `role separation`, `conversation spacing`, `return clarity`.

### localized_rewrite_probe

Listen for a repairable middle section, preserved whole-piece coherence, and a coloristic cadence that does not blur the form. Strongest or weakest labels that fit this benchmark include `harmonic color`, `middle-section repair`, `cadence color`, `rewrite stability`, `whole-piece drift`.

## Pending Rows And Artifacts

1. row 2
   songId: 2026-04-19-current-state-counterline-revalidate-s1-r01-cadence_clarity_reference-r01
   benchmark: cadence_clarity_reference
   selectedWorker: learned_symbolic
   manifest: outputs/2026-04-19-current-state-counterline-revalidate-s1-r01-cadence_clarity_reference-r01/manifest.json
   midi: outputs/2026-04-19-current-state-counterline-revalidate-s1-r01-cadence_clarity_reference-r01/humanized.mid
   audio: outputs/2026-04-19-current-state-counterline-revalidate-s1-r01-cadence_clarity_reference-r01/output.wav
   score: outputs/2026-04-19-current-state-counterline-revalidate-s1-r01-cadence_clarity_reference-r01/score-preview.svg

2. row 3
   songId: 2026-04-19-stage-a-s1-postrepair-full-pack-r01-cadence_clarity_reference-r01
   benchmark: cadence_clarity_reference
   selectedWorker: learned_symbolic
   manifest: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-cadence_clarity_reference-r01/manifest.json
   midi: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-cadence_clarity_reference-r01/humanized.mid
   audio: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-cadence_clarity_reference-r01/output.wav
   score: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-cadence_clarity_reference-r01/score-preview.svg

3. row 4
   songId: 2026-04-19-current-state-counterline-postrepair-s1-r01-cadence_clarity_reference-r01
   benchmark: cadence_clarity_reference
   selectedWorker: learned_symbolic
   manifest: outputs/2026-04-19-current-state-counterline-postrepair-s1-r01-cadence_clarity_reference-r01/manifest.json
   midi: outputs/2026-04-19-current-state-counterline-postrepair-s1-r01-cadence_clarity_reference-r01/humanized.mid
   audio: outputs/2026-04-19-current-state-counterline-postrepair-s1-r01-cadence_clarity_reference-r01/output.wav
   score: outputs/2026-04-19-current-state-counterline-postrepair-s1-r01-cadence_clarity_reference-r01/score-preview.svg

4. row 5
   songId: 2026-04-19-current-state-counterline-prepatch-s1-r01-cadence_clarity_reference-r01
   benchmark: cadence_clarity_reference
   selectedWorker: learned_symbolic
   manifest: outputs/2026-04-19-current-state-counterline-prepatch-s1-r01-cadence_clarity_reference-r01/manifest.json
   midi: outputs/2026-04-19-current-state-counterline-prepatch-s1-r01-cadence_clarity_reference-r01/humanized.mid
   audio: outputs/2026-04-19-current-state-counterline-prepatch-s1-r01-cadence_clarity_reference-r01/output.wav
   score: outputs/2026-04-19-current-state-counterline-prepatch-s1-r01-cadence_clarity_reference-r01/score-preview.svg

5. row 6
   songId: 2026-04-19-projection-fix-smoke-s1-duo-r01-cadence_clarity_reference-r01
   benchmark: cadence_clarity_reference
   selectedWorker: learned_symbolic
   manifest: outputs/2026-04-19-projection-fix-smoke-s1-duo-r01-cadence_clarity_reference-r01/manifest.json
   midi: outputs/2026-04-19-projection-fix-smoke-s1-duo-r01-cadence_clarity_reference-r01/humanized.mid
   audio: outputs/2026-04-19-projection-fix-smoke-s1-duo-r01-cadence_clarity_reference-r01/output.wav
   score: outputs/2026-04-19-projection-fix-smoke-s1-duo-r01-cadence_clarity_reference-r01/score-preview.svg

6. row 7
   songId: 2026-04-19-current-state-counterline-revalidate-s1-r01-counterline_dialogue_probe-r01
   benchmark: counterline_dialogue_probe
   selectedWorker: learned_symbolic
   manifest: outputs/2026-04-19-current-state-counterline-revalidate-s1-r01-counterline_dialogue_probe-r01/manifest.json
   midi: outputs/2026-04-19-current-state-counterline-revalidate-s1-r01-counterline_dialogue_probe-r01/humanized.mid
   audio: outputs/2026-04-19-current-state-counterline-revalidate-s1-r01-counterline_dialogue_probe-r01/output.wav
   score: outputs/2026-04-19-current-state-counterline-revalidate-s1-r01-counterline_dialogue_probe-r01/score-preview.svg

7. row 8
   songId: 2026-04-19-stage-a-s1-postrepair-full-pack-r01-counterline_dialogue_probe-r01
   benchmark: counterline_dialogue_probe
   selectedWorker: learned_symbolic
   manifest: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-counterline_dialogue_probe-r01/manifest.json
   midi: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-counterline_dialogue_probe-r01/humanized.mid
   audio: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-counterline_dialogue_probe-r01/output.wav
   score: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-counterline_dialogue_probe-r01/score-preview.svg

8. row 9
   songId: 2026-04-19-current-state-counterline-postrepair-s1-r01-counterline_dialogue_probe-r01
   benchmark: counterline_dialogue_probe
   selectedWorker: learned_symbolic
   manifest: outputs/2026-04-19-current-state-counterline-postrepair-s1-r01-counterline_dialogue_probe-r01/manifest.json
   midi: outputs/2026-04-19-current-state-counterline-postrepair-s1-r01-counterline_dialogue_probe-r01/humanized.mid
   audio: outputs/2026-04-19-current-state-counterline-postrepair-s1-r01-counterline_dialogue_probe-r01/output.wav
   score: outputs/2026-04-19-current-state-counterline-postrepair-s1-r01-counterline_dialogue_probe-r01/score-preview.svg

9. row 10
   songId: 2026-04-19-current-state-counterline-prepatch-s1-r01-counterline_dialogue_probe-r01
   benchmark: counterline_dialogue_probe
   selectedWorker: music21
   manifest: outputs/2026-04-19-current-state-counterline-prepatch-s1-r01-counterline_dialogue_probe-r01/manifest.json
   midi: outputs/2026-04-19-current-state-counterline-prepatch-s1-r01-counterline_dialogue_probe-r01/humanized.mid
   audio: outputs/2026-04-19-current-state-counterline-prepatch-s1-r01-counterline_dialogue_probe-r01/output.wav
   score: outputs/2026-04-19-current-state-counterline-prepatch-s1-r01-counterline_dialogue_probe-r01/score-preview.svg

10. row 11
    songId: 2026-04-19-projection-fix-smoke-s1-duo-r01-counterline_dialogue_probe-r01
    benchmark: counterline_dialogue_probe
    selectedWorker: music21
    manifest: outputs/2026-04-19-projection-fix-smoke-s1-duo-r01-counterline_dialogue_probe-r01/manifest.json
    midi: outputs/2026-04-19-projection-fix-smoke-s1-duo-r01-counterline_dialogue_probe-r01/humanized.mid
    audio: outputs/2026-04-19-projection-fix-smoke-s1-duo-r01-counterline_dialogue_probe-r01/output.wav
    score: outputs/2026-04-19-projection-fix-smoke-s1-duo-r01-counterline_dialogue_probe-r01/score-preview.svg

11. row 12
    songId: 2026-04-19-stage-a-s1-postrepair-full-pack-r01-localized_rewrite_probe-r01
    benchmark: localized_rewrite_probe
    selectedWorker: learned_symbolic
    manifest: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-localized_rewrite_probe-r01/manifest.json
    midi: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-localized_rewrite_probe-r01/humanized.mid
    audio: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-localized_rewrite_probe-r01/output.wav
    score: outputs/2026-04-19-stage-a-s1-postrepair-full-pack-r01-localized_rewrite_probe-r01/score-preview.svg