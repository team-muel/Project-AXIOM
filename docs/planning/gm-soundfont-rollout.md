# AXIOM GM SoundFont Rollout

Status: COMPLETED REFERENCE — `MuseScore_General.sf3`가 runtime default로 채택된 이후의 rollout 기록과 benchmark 재생성 절차를 보관한다.

## Current Status

1. Near-term delivery order item 1 is complete: the `symbolic_plus_audio` artifact contract is now aligned across code, docs, and tests.
2. Near-term delivery order item 2 is complete: `MuseScore_General.sf3` has been selected as the runtime default GM SoundFont.
3. Runtime defaults now point to `assets/soundfonts/MuseScore_General.sf3` in `src/config.ts` and `.env.example`.
4. The runtime still reports `ready_degraded` in the current environment because `ffmpeg` and the MusicGen Python stack are not installed, not because of the new SoundFont candidate.
5. Three representative comparison pieces have now been rendered against `default.sf2`, `MuseScore_General.sf3`, and `GeneralUser GS 2.0.3`: one piano-led miniature, one sustained strings texture, and one brass-led color study with woodwind support.
6. `GeneralUser GS 2.0.3` remains the comparison or fallback candidate; `default.sf2` remains the benchmark baseline.
7. Candidate readiness was checked with `SOUNDFONT_PATH=assets/soundfonts/MuseScore_General.sf3`; `/ready` kept `soundfont=true`, `fluidsynth=true`, and `audioRender=true`.
8. An objective companion report has been generated at `outputs/_validation_render_preview/benchmark-metrics.json` and `outputs/_validation_render_preview/benchmark-metrics.md` to support the listening pass.
9. The objective report can now be regenerated with `npm run benchmark:soundfont:metrics`.
10. A reproducible listening corpus and blind-comparison playlist can now be generated with `npm run benchmark:soundfont:playlist`.
11. With item 2 closed, the next planning focus moves beyond timbre replacement and back to the broader multimodel roadmap.

## Benchmark Inventory

1. Piano-led miniature
   - Source MIDI: `outputs/01fa088c-b281-49a6-9d1b-072f81be51cd/humanized.mid`
   - Comparison renders: `outputs/_validation_render_preview/default_sf2/`, `outputs/_validation_render_preview/musescore_general_sf3/`, `outputs/_validation_render_preview/generaluser_gs_203/`

2. Sustained strings texture
   - Source MIDI: `outputs/10316926-ddff-4a9b-a088-4e2394c46e36/humanized.mid`
   - Comparison renders: `outputs/_validation_render_preview/strings_chamber/default_sf2/`, `outputs/_validation_render_preview/strings_chamber/musescore_general_sf3/`, `outputs/_validation_render_preview/strings_chamber/generaluser_gs_203/`

3. Brass-led color study with woodwind support
   - Source MIDI: `outputs/584277bd-a799-4379-b046-ce02d589b0c5/humanized.mid`
   - Comparison renders: `outputs/_validation_render_preview/winds_brass/default_sf2/`, `outputs/_validation_render_preview/winds_brass/musescore_general_sf3/`, `outputs/_validation_render_preview/winds_brass/generaluser_gs_203/`

## Regenerate Objective Report

1. Run `npm run benchmark:soundfont:metrics` from the repo root.
2. The command expects the benchmark inventory layout above and rewrites `outputs/_validation_render_preview/benchmark-metrics.json` plus `outputs/_validation_render_preview/benchmark-metrics.md`.
3. To target a different benchmark root, pass `-- --root <path>`.

## Generate Listening Corpus

1. Run `npm run benchmark:soundfont:playlist` from the repo root.
2. The command expects the same benchmark inventory layout and writes these operator-facing artifacts under `outputs/_validation_render_preview/`:
   - `benchmark-corpus.json`
   - `benchmark-corpus.md`
   - `benchmark-playlist.m3u`
   - `benchmark-playlist-blind.m3u`
   - `benchmark-playlist-blind-map.json`
3. Use the blind playlist for listening sessions and keep the blind map hidden until after notes are recorded.
4. To target a different benchmark root, pass `-- --root <path>`.

## Goal

Improve symbolic render timbre with the smallest runtime change.
The first slice should replace the single global GM SoundFont used by the symbolic render path, without changing request contracts, restart recovery, or operator surfaces.

## Current Constraints

1. Symbolic render reads one runtime-wide `SOUNDFONT_PATH`.
2. The `music21` worker still realizes instrumentation as two concrete parts: one lead-or-counterline part and one accompaniment part.
3. In `symbolic_plus_audio`, canonical `audio` remains the score-aligned rendered WAV and prompt-regenerated output stays only in `styledAudio`.
4. This slice is about symbolic timbre only; it is not a MusicGen or `audio_only` quality project.

## Candidate Order

1. `MuseScore_General.sf3`
   - Selected default GM SoundFont.
   - Best first-pass balance of quality, size, and runtime fit.

2. `GeneralUser GS 2.0.3`
   - Primary comparison and fallback candidate.
   - Good GM coverage and strong FluidSynth compatibility, but more synth-implementation-sensitive.

3. `MuseScore_General.sf2`
   - Fallback candidate when `.sf3` packaging or startup behavior is inconvenient.

## Acquisition Sources

1. `MuseScore_General.sf3`
   - Direct download: [MuseScore_General.sf3](https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3)
   - Reference page: [MuseScore handbook SoundFonts page](https://musescore.org/en/handbook/3/soundfonts-and-sfz-files)
   - License: MIT
   - Operational note: smaller than the `.sf2` package, but SF3 startup can still be slower than very small banks.

2. `GeneralUser GS 2.0.3`
   - Direct download: [GeneralUser GS 2.0.3](https://drive.google.com/uc?export=download&id=12ZzM70Nxnr4vqyUF0bbRKE_HXQgLRNid)
   - Reference page: [GeneralUser GS official page](https://www.schristiancollins.com/generaluser.php)
   - Compatibility note: current release targets FluidSynth 2.3 or later.
   - License note: license and documentation are distributed with the package; the author explicitly states published music use is allowed.

3. `MuseScore_General.sf2`
   - Direct download: [MuseScore_General.sf2](https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2)
   - Reference page: [MuseScore handbook SoundFonts page](https://musescore.org/en/handbook/3/soundfonts-and-sfz-files)
   - License: MIT
   - Operational note: much larger package size, so keep it as fallback rather than first default.

## Local Placement Rules

1. Keep `assets/soundfonts/default.sf2` intact as the benchmark baseline.
2. Place each candidate under `assets/soundfonts/` using its upstream filename.
3. Use `assets/soundfonts/MuseScore_General.sf3` as the default path unless an operator explicitly overrides `SOUNDFONT_PATH`.
4. Keep `GeneralUser GS 2.0.3` available for comparison renders and rollback testing.

## Not In Scope For Slice 1

1. SFZ or VST integration.
2. Piano-only or single-family specialty libraries.
3. Request-scoped or section-scoped timbre selection.
4. Dedicated orchestration pass changes.

## Rollout Steps

1. Keep `MuseScore_General.sf3` as the runtime default.
2. Render the same symbolic piece with the baseline SoundFont and the selected default when re-validating timbre.
3. Repeat for at least three short pieces when a new comparison candidate is introduced:
   - piano-led miniature
   - strings or sustained chamber texture
   - woodwind or brass color test
4. Compare rendered WAVs on these checks:
   - piano attack and decay
   - string sustain and loop smoothness
   - woodwind and brass harshness
   - low-end balance in accompaniment
   - obvious clipping, noise, or unnatural release tails

## Acceptance Criteria

1. No code changes are required to switch the SoundFont.
2. `/ready` still reports audio render capability normally.
3. `symbolic_only` and `symbolic_plus_audio` still produce the same artifact layout.
4. The selected candidate is clearly better than `default.sf2` on at least piano plus one non-piano family.
5. No new operational regressions appear in restart recovery or preview asset generation.

## Suggested Verification

1. Confirm the default `SOUNDFONT_PATH` resolves to `assets/soundfonts/MuseScore_General.sf3` or override it explicitly for A/B tests.
2. Run one `symbolic_only` composition and confirm `output.wav` still renders.
3. Run one `symbolic_plus_audio` composition and confirm:
   - `audio` remains the rendered WAV
   - `styledAudio` is still separate
4. Listen to the baseline and fallback renders back to back before changing the default again.

## After Slice 1

Only after a stable GM replacement is chosen should AXIOM consider:

1. request-scoped SoundFont selection
2. SFZ or VST rendering
3. orchestration-aware library routing
