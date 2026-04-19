# 곡 Manifest 스키마

작곡 파이프라인이 생성하는 곡별 manifest 파일의 구조 정의.  
각 곡의 산출물은 `outputs/<songId>/manifest.json`에 저장된다.  
autonomy 관련 시스템 상태는 `outputs/_system/` 아래 별도 파일로 저장된다.

## JobManifest

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `songId` | `string` | 곡 고유 ID (UUID v4) |
| `state` | `PipelineState` | 현재 파이프라인 상태 |
| `meta` | `SongMeta` | 곡 메타데이터 |
| `artifacts` | `ArtifactPaths` | 산출물 파일 경로 |
| `errorCode` | `string?` | 실패 원인 코드 |
| `errorMessage` | `string?` | 실패 상세 메시지 |
| `selfAssessment` | `SelfAssessment?` | 완료 후 Gemma 기반 자기평가 결과 |
| `structureEvaluation` | `StructureEvaluationReport?` | 규칙 기반 심벌릭 구조 평가 결과 |
| `audioEvaluation` | `AudioEvaluationReport?` | 렌더/스타일 오디오 산출물 평가 결과 |
| `qualityControl` | `QualityControlReport?` | 자동 재작곡 품질 루프의 정책, 시도 이력, 최종 선택 결과 |
| `approvalStatus` | `ApprovalStatus?` | autonomy 곡의 승인 상태 (`pending`, `approved`, `rejected`, `not_required`) |
| `evaluationSummary` | `string?` | 평가 요약 또는 승인/반려 메모 |
| `reviewFeedback` | `ReviewFeedback?` | 승인 또는 반려 시 기록한 structured review payload |
| `runtime` | `RuntimeStatus?` | 현재 실행 단계, compose worker progress, restart recovery 메타데이터 |
| `stateHistory` | `StateEntry[]` | 상태 전이 이력 |
| `updatedAt` | `string` | 마지막 업데이트 시각 (ISO 8601) |

## SongMeta

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `songId` | `string` | 곡 고유 ID |
| `prompt` | `string` | 작곡 프롬프트 |
| `key` | `string?` | 조성 (예: `"C major"`) |
| `tempo` | `number?` | 템포 BPM |
| `form` | `string?` | 형식 (예: `"miniature"`, `"sonata"`) |
| `source` | `"api" \| "autonomy"` | 요청 생성 주체 |
| `autonomyRunId` | `string?` | autonomy planner가 생성한 run ID |
| `promptHash` | `string?` | 중복 방지와 ledger 연결에 사용하는 요청 해시 |
| `workflow` | `"symbolic_only" \| "symbolic_plus_audio" \| "audio_only"` | 계획된 작곡 워크플로 |
| `plannerVersion` | `string?` | planner schema 버전 |
| `plannedSectionCount` | `number?` | planner가 생성한 섹션 수 |
| `selectedModels` | `ModelBinding[]?` | planner/structure/audio 역할별 선택 모델 |
| `plannerTelemetry` | `PlannerTelemetry?` | 선택된 planner candidate와 novelty 판단 요약 |
| `createdAt` | `string` | 생성 시각 (ISO 8601) |
| `updatedAt` | `string` | 업데이트 시각 (ISO 8601) |

## PlannerTelemetry

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `selectionStrategy` | `string?` | candidate selection 전략 식별자 |
| `selectedCandidateId` | `string?` | 선택된 planner candidate ID |
| `selectedCandidateLabel` | `string?` | 선택된 candidate의 사람이 읽기 쉬운 라벨 |
| `selectedCandidateIndex` | `number?` | 선택된 candidate의 0-based index |
| `candidateCount` | `number?` | 비교한 planner candidate 수 |
| `parserMode` | `"structured_json" \| "fallback"` | strict JSON parser를 썼는지 fallback 복구를 썼는지 |
| `planSignature` | `string?` | novelty 비교용 정규화 signature |
| `noveltyScore` | `number?` | 0-1 novelty 점수 |
| `repeatedAxes` | `string[]?` | 최근 run과 겹친 축 요약 |
| `exactMatch` | `boolean?` | 최근 signature와 exact match인지 여부 |
| `selectionScore` | `number?` | candidate selection 최종 점수 |
| `qualityScore` | `number?` | completeness/parser 기반 quality 점수 |

## SelfAssessment

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `generatedAt` | `string` | 평가 생성 시각 |
| `summary` | `string` | 한 문단 요약 |
| `qualityScore` | `number?` | 품질 점수 |
| `strengths` | `string[]` | 강점 목록 |
| `weaknesses` | `string[]` | 약점 목록 |
| `tags` | `string[]` | 분위기/특성 태그 |
| `raw` | `string` | 원본 LLM 응답 |

## RuntimeStatus

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `stage` | `PipelineState` | 현재 실행 중인 파이프라인 단계 |
| `stageStartedAt` | `string` | 현재 단계 시작 시각 |
| `updatedAt` | `string` | runtime 정보 마지막 갱신 시각 |
| `detail` | `string?` | 현재 단계 또는 compose worker의 세부 상태 |
| `compose` | `ComposeWorkerProgress?` | compose worker 진행 상태 |
| `recovery` | `RecoveryMetadata?` | 재시작 후 복구된 작업인지 여부와 메모 |

## ComposeWorkerProgress

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `worker` | `"music21" \| "musicgen" \| "learned_symbolic"` | 사용된 compose worker |
| `phase` | `ComposeWorkerPhase` | compose worker 내부 진행 단계 |
| `updatedAt` | `string` | 마지막 heartbeat 시각 |
| `detail` | `string?` | 내부 상태 설명 |
| `outputPath` | `string?` | 현재 또는 최종 산출물 경로 |
| `durationSec` | `number?` | MusicGen 완료 시 추정 길이 |

## RecoveryMetadata

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `recoveredFromRestart` | `boolean` | 프로세스 재시작 후 복구된 작업인지 여부 |
| `recoveredAt` | `string` | 복구 시각 |
| `note` | `string?` | 복구 사유 또는 메모 |

## ApprovalStatus

| 값 | 설명 |
| ---- | ---- |
| `pending` | autonomy run 완료 후 사람 승인 대기 |
| `approved` | 사람이 승인 완료 |
| `rejected` | 사람이 반려 완료 |
| `not_required` | 수동 API 등 승인 대상이 아님 |

중요: `approvalStatus`와 `reviewFeedback`는 계속 `outputs/<songId>/manifest.json`에 저장되지만, operator mutation 자체의 audit trail은 별도 truth-plane artifact인 `outputs/_system/operator-actions/latest.json` 및 `history/YYYY-MM-DD.jsonl`에 남는다. approve/reject record는 최소 `actor`, `surface`, `action`, `reason`, `input`, `before`, `after`, `artifactLinks`, `approvedBy`, `observedAt`를 포함하며, 필요하면 `rollbackNote`, `manualRecoveryNote`도 함께 남긴다. 보통 manifest, `outputs/_system/preferences.json`, 관련 autonomy run ledger 파일을 함께 가리킨다.

## ReviewFeedback

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `reviewRubricVersion` | `string?` | approve/reject 시 적용한 고정 review rubric 버전. 현재 runtime은 `approval_review_rubric_v1`를 기록한다. |
| `note` | `string?` | 승인 메모 또는 반려 사유 |
| `appealScore` | `number?` | 사람 기준 매력도 점수 (보통 0-10) |
| `strongestDimension` | `string?` | 가장 좋았던 음악적 요소 |
| `weakestDimension` | `string?` | 가장 약했던 음악적 요소 |
| `comparisonReference` | `string?` | 비교 기준이 된 다른 곡, run, 또는 shortlist reference |

## ArtifactPaths

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `midi` | `string?` | MIDI 파일 경로 |
| `scoreImage` | `string?` | SVG 악보 미리보기 경로 |
| `audio` | `string?` | 주 오디오 경로. `symbolic_plus_audio`에서도 score-aligned rendered WAV를 유지한다. |
| `renderedAudio` | `string?` | MIDI를 렌더한 preview WAV 경로 |
| `styledAudio` | `string?` | MusicGen 기반 styled WAV 경로 |
| `video` | `string?` | preview MP4 경로 (ffmpeg와 WAV가 있을 때) |

`symbolic_plus_audio`에서는 `audio`가 render 단계의 canonical preview WAV를 계속 가리키고, prompt-regenerated 결과는 `styledAudio`에만 저장된다. symbolic 계열 워크플로에서는 `scoreImage`(`score-preview.svg`)가 기본 operator 확인 표면이다. render 단계가 hydrate된 expression plan과 section artifact를 함께 받으면 이 SVG에는 `Expression Profile` 패널이 추가될 수 있으며, 여기에는 `humanizationStyle`, 전역 `expressionDefaults`, 전역 `tempoMotionDefaults`, 전역 `ornamentDefaults`, section별 expression/tempo-motion/ornament cue, 그리고 실제 velocity range 요약이 함께 표시된다. 이 overlay는 render 시점에 계산되며 별도 manifest 필드로 다시 저장되지는 않는다.

## Section Artifacts Sidecar

`outputs/<songId>/section-artifacts.json`은 manifest 본문을 가볍게 유지하기 위해 section-local symbolic render artifact를 별도 저장한다.

각 section artifact에는 melody/accompaniment event, note history, register center, melody/bass pitch range, melody/accompaniment velocity range, bass motion profile, cadence approach, section style, harmonic plan의 `harmonyDensity`/`voicingProfile`뿐 아니라 deeper phrase/harmonic contract (`phraseSpanShape`, `continuationPressure`, `cadentialBuildup`, `prolongationMode`, `tonicizationWindows`)도 포함될 수 있다. 이제 첫 harmonic-color contract slice로 `harmonicColorCues`도 함께 남을 수 있으며, cue는 `mixture`, `applied_dominant`, `predominant_color`, `suspension` tag와 local measure window, optional `keyTarget`, optional `resolutionMeasure`를 보존한다. phrase/texture summary (`phraseFunction`, `textureVoiceCount`, `primaryTextureRoles`, `counterpointMode`, `textureNotes`)와 정규화된 expression guidance (`expressionDynamics`, `articulation`, `character`, `phrasePeaks`, `sustainBias`, `accentBias`)도 함께 저장된다. 이 expression tag는 이제 초기 최소 subset에만 제한되지 않고 `tenuto`, `sostenuto`, `staccatissimo`, `marcato`, `tranquillo`, `grazioso`, `energico` 같은 확장 articulation/character cue도 그대로 남길 수 있다. humanize가 phrase-breath cue를 적용한 뒤에는 section-local `phraseBreathSummary`도 함께 저장될 수 있으며, 여기에는 requested cue, targeted or realized measure coverage, realized note count, overall duration or jitter or ending-stretch scale, peak duration-scale contrast와 함께 cue별 pickup, arrival, release, cadence recovery, rubato anchor 평균 timing evidence가 들어간다. audio evaluation은 이 evidence를 읽어 `audioPhraseBreathPlanFit`, `audioPhraseBreathCoverageFit`, `audioPhraseBreathPickupFit`, `audioPhraseBreathArrivalFit`, `audioPhraseBreathReleaseFit`, `audioPhraseBreathRecoveryFit`, `audioPhraseBreathRubatoFit`를 계산한다. render preview의 `Expression Profile` line은 이 summary를 `breath fit ...` compact fragment로 다시 보여 줄 수 있으며, 이제 recovery와 rubato evidence도 present일 때 함께 실어 operator가 raw MIDI diff 없이 cadence reset이나 local stretch가 실제로 남았는지 빠르게 확인할 수 있다. humanize가 harmonic cue를 timing profile에 합성한 뒤에는 section-local `harmonicRealizationSummary`도 함께 저장될 수 있으며, 여기에는 `prolongationMode`, requested tonicization target, requested color tag, targeted or realized measure coverage, realized note count, overall duration or jitter or ending-stretch scale, peak duration-scale contrast와 함께 prolongation, tonicization, harmonic-color window별 평균 sustain or stretch evidence가 들어간다. render preview의 `Expression Profile` line은 이 summary를 `harm fit ...` compact fragment로 다시 보여 줄 수 있으므로 operator가 raw MIDI diff 없이 local prolongation 또는 suspension broadening이 실제로 걸렸는지 빠르게 확인할 수 있다. audio evaluation은 이제 같은 summary를 읽어 `audioHarmonicRealizationPlanFit`, `audioHarmonicRealizationCoverageFit`, `audioHarmonicRealizationDensityFit`, `audioTonicizationRealizationFit`, `audioProlongationRealizationFit`, `audioHarmonicColorRealizationFit`를 계산하고, audio retry는 그 값이 약할 때 localized `stabilize_harmony` 또는 `clarify_harmonic_color` directive를 weak section에만 다시 걸 수 있다. humanize가 tempo-motion cue를 적용한 뒤에는 section-local `tempoMotionSummary`도 함께 저장될 수 있으며, 여기에는 requested tag, targeted measure count, realized measure or note coverage, average duration or jitter scale, peak duration-scale contrast, direction(`broaden`, `press_forward`, `neutral`) 같은 evidence가 들어간다. accompaniment event는 필요 시 `voiceRole`을 포함해 note-wise `bass`, `inner_voice`, `counterline` 같은 실현 역할을 남길 수 있다. string-trio orchestration 평가는 melody/bass lane과 이 `voiceRole` tagged accompaniment evidence를 함께 읽어 idiomatic range, lead-middle-bass balance, conversational exchange를 section-local로 다시 채점한다. texture contract가 `counterline` 또는 `inner_voice`를 요구한 section은 heuristic secondary-line summary (`secondaryLinePitchCount`, `secondaryLineSpan`, `secondaryLineDistinctPitchClasses`, `textureIndependentMotionRate`, `textureContraryMotionRate`)도 남길 수 있으며, structure evaluation은 summary field가 비어 있어도 이 tagged accompaniment event를 읽어 secondary-line motion, contrary-motion, motif evidence를 다시 복원할 수 있다. planned imitative section은 이 secondary-line에서 포착한 part-aware motif shape를 `secondaryLineMotif`로 남길 수 있으며, structure evaluation은 이 값을 우선 사용해 imitation survival을 계산한다. 이 정보는 structure evaluation이 계획 대비 실현 정도를 채점할 때 사용되고, render 단계에서는 section label과 함께 score preview의 expression summary line으로 다시 요약될 수 있다.

ornament cue가 명시적으로 실재화된 section은 `ornamentSummary`도 함께 남길 수 있다. 현재는 `fermata`, explicit local window plus `targetBeat`가 있는 `arpeggio`, explicit local window plus `targetBeat`가 있는 `grace_note`, 그리고 explicit local window plus `targetBeat`가 있는 `trill`이 우선 대상이며, 이 summary에는 requested tag, explicitly realized tag, targeted or realized event count, realized note count, average duration or jitter scale, ending stretch, peak duration-scale contrast 같은 local hold evidence와 함께 `averageOnsetSpreadBeats`/`peakOnsetSpreadBeats` 같은 arpeggio roll evidence, `averageGraceLeadInBeats`/`peakGraceLeadInBeats` 같은 grace-note lead-in evidence, `averageTrillOscillationCount`/`peakTrillOscillationCount`와 `averageTrillSpanBeats`/`peakTrillSpanBeats` 같은 trill oscillation evidence가 들어갈 수 있다. audio evaluation은 이 evidence를 읽어 `audioOrnamentPlanFit`, `audioOrnamentCoverageFit`, `audioOrnamentHoldFit`, `audioOrnamentArpeggioFit`, `audioOrnamentGraceFit`, `audioOrnamentTrillFit`를 계산한다. quality loop retry는 아직 fermata hold만 대상으로 하므로 필요하면 localized `shape_ornament_hold` directive를 만들고, arpeggio, grace-note, trill은 현재 operator-visible scoring까지만 제공한다.

## Expression Plan Sidecar

`outputs/<songId>/expression-plan.json`은 planner 또는 revision loop가 확정한 named expression intent를 manifest 본문 밖에 저장한다.

이 sidecar에는 전역 `expressionDefaults`, 전역 `tempoMotionDefaults`, 전역 `ornamentDefaults`, section별 `expression`, section별 `tempoMotion`, section별 `ornaments`, section별 `phraseBreath`, 그리고 필요 시 `version`/`humanizationStyle`가 포함된다. `phraseBreath`는 additive contract로서 pickup or preparation, local arrival, release window, cadence recovery, rubato anchor를 보존한다. restart recovery와 queue retry는 이 파일을 다시 hydrate하여 최신 expression intent를 recovered request의 `compositionPlan`에 merge한다. 전역 texture, expression, tempo-motion, ornament defaults 가운데 하나라도 있으면 sidecar는 모든 section의 `startMeasure`/`endMeasure` window도 함께 남겨 humanize가 default cue를 section-local evidence로 다시 묶을 수 있게 한다. 같은 sidecar는 humanize 단계에도 전달되어 timing/velocity shaping을 보정하고, render 및 styled audio prompt 생성 단계에도 전달되어 planner가 의도한 dynamics/articulation/character cue와 local tempo-motion or ornament cue가 최종 preview surface까지 유지되도록 한다. humanize는 이 sidecar와 더불어 현재 request의 section `harmonicPlan`도 함께 읽어 `prolongationMode`, `tonicizationWindows`, `harmonicColorCues` 또는 `colorCues`에 해당하는 local sustain or arrival broadening을 timing profile에 합성할 수 있다. 현재 humanize 경로는 `tenuto`, `sostenuto`, `staccatissimo`, `marcato`, `tranquillo`, `grazioso`, `energico` 같은 확장 tag도 받아 note gate length, average velocity profile, ending stretch를 다르게 만들 수 있고, `ritardando`, `rallentando`, `allargando`, `accelerando`, `stringendo`, `a tempo`, `ritenuto`, `tempo l'istesso` 같은 cue도 section-local duration and jitter shaping으로 반영할 수 있다. `phraseBreath` 역시 이제 humanize timing profile에 합성되어 pickup 구간의 약한 anticipatory press-forward, arrival의 broadening, release의 easing, rubato anchor의 국소 stretch, cadence recovery의 partial reset을 만들 수 있고, `prolongationMode`, `tonicizationWindows`, `harmonicColorCues`도 local sustain or overlap shaping을 보조한다. 그 결과 phrase-breath survival evidence는 `section-artifacts.json`의 `phraseBreathSummary`로, harmonic survival evidence는 `harmonicRealizationSummary`로 남아 render preview와 downstream evaluation or retry targeting이 같은 local evidence를 다시 읽을 수 있다. ornament tag는 `grace_note`, `trill`, `mordent`, `turn`, `arpeggio`, `fermata`를 구조적으로 보존하며, 현재는 `fermata`가 target beat 또는 section-final event 기준 local hold로, `arpeggio`는 explicit local window plus target beat가 주어진 chord event 기준 rolled onset으로, `grace_note`는 explicit local window plus target beat가 주어진 note event 기준 short lead-in으로, `trill`은 explicit local window plus target beat가 주어진 note event 기준 upper-neighbor oscillation으로 먼저 실재화된다.

## Candidate Evidence Sidecars

symbolic workflow에서 structure evaluation retry가 켜진 run은 final winning manifest 외에도 candidate-local evidence를 `outputs/<songId>/candidates/` 아래 별도 저장한다. 이 경로는 structure reranker dataset export와 shadow reranker 분석이 final manifest 한 장만으로는 잃어버리던 attempt-level evidence를 다시 읽을 수 있게 하기 위한 truth-plane sidecar다.

- `outputs/<songId>/candidates/index.json`: structure attempt candidate index. `selectedCandidateId`, `selectedAttempt`, `selectionStopReason`, optional `rerankerPromotion`, `entries[]`를 담고 각 entry는 `candidateId`, `attempt`, `selected`, `workflow`, `worker`, `provider`, `model`, `passed`, `score`, `evaluatedAt`, `manifestPath`, optional `proposalEvidence`, `sectionArtifactsPath`, `midiPath`를 가진다. `candidateId`는 기본적으로 attempt + worker binding digest를 쓰지만, 같은 attempt 안에서 search budget이 baseline/learned 두 슬롯을 넘기면 optional variant token(`baseline-2`, `learned-2` 등)이 추가되어 same-attempt candidate sidecar가 충돌 없이 공존한다. `proposalEvidence`는 learned proposal worker가 남긴 `lane`, `provider`, `model`, optional `benchmarkPackVersion`, optional `benchmarkId`, optional `promptPackVersion`, optional `planSignature`, `generationMode`, `confidence`, `normalizationWarnings`, compact proposal summary를 담는다. `normalizationWarnings`에는 seeded fallback, provider control mismatch 보조 경고, section-level role collapse 같은 projection diagnostics가 들어갈 수 있다. 같은 evidence는 이제 `structure_rank_v1` export, offline shadow reranker training, runtime shadow scoring이 공통 feature input으로 재사용하며, learned disagreement explanation에는 `hasProposalEvidence`, `proposalWorker:<worker>`, `proposalLane:<lane>`, `proposalGenerationMode:<mode>`, `proposalConfidence`, `proposalSummaryPartCount` 같은 feature 이름이 직접 나타날 수 있다. reviewed manifest를 dataset으로 내보낼 때는 이 truth-plane을 다시 읽어 `reviewSignals`(approval status, review rubric version, note, appeal score, strongest or weakest dimension, comparison reference), selected-attempt input directive kinds or section ids, retry localization, 그리고 selected candidate의 targeted rewrite transform context까지 함께 싣는다. L6 targeted rewrite가 revision context를 소비한 attempt는 여기서 `proposalEvidence.generationMode=targeted_section_rewrite`로 보이며, narrow learned lane이 proposal-only candidate에서 localized rewrite candidate로 진입했는지 한 줄로 구분할 수 있다. fixed benchmark pack에 속하는 run은 `proposalEvidence.benchmarkPackVersion`, optional `proposalEvidence.benchmarkId`, 그리고 `proposalEvidence.planSignature`로 later export, audit, reranker analysis에서 같은 evaluation harness를 다시 묶을 수 있다. `rerankerPromotion`은 narrow lane에서 learned authority promotion이 실제 적용됐을 때 `lane`, `snapshotId`, `confidence`, heuristic/learned top candidate id와 attempt, appliedAt, reason을 담는다.
- `outputs/<songId>/candidates/<candidateId>/candidate-manifest.json`: attempt-local compact manifest. 현재는 `meta`, `executionPlan`, `compositionPlan`, `qualityPolicy`, `revisionDirectives`, `structureEvaluation`, optional `proposalEvidence`, optional `sectionTonalities`, optional `sectionTransforms`, `selected`, `selectedAt`, optional `shadowReranker`, optional `rerankerPromotion`, attempt-local artifact 경로를 담는다.

  여기서 `revisionDirectives`는 다음 hypothetical attempt를 위한 제안이 아니라, 해당 candidate를 실제로 생성할 때 소비한 retry input context다. learned targeted rewrite가 실행된 section은 `sectionArtifacts[].transform`과 `sectionTransforms[]`에 `transformMode=targeted_rewrite:<directive>`를 남겨 어떤 weak section이 localized rewrite 대상이었는지 compact manifest만으로 audit할 수 있다.
- `outputs/<songId>/candidates/<candidateId>/section-artifacts.json`: 해당 structure attempt에서 생성된 section artifact snapshot. final manifest의 sidecar와 동일한 schema를 따르지만 selected attempt가 아니어도 보존된다.
- `outputs/<songId>/candidates/<candidateId>/composition.mid`: 해당 structure attempt의 raw symbolic MIDI snapshot. retry 과정에서 후속 attempt가 final root MIDI를 덮어써도 earlier candidate evidence는 남는다.
- `outputs/<songId>/candidates/<candidateId>/reranker-score.json`: runtime shadow scoring이 켜져 있고 모델 snapshot이 준비되어 있을 때 기록되는 learned-vs-heuristic 비교 evidence. candidate별 `heuristic.score/rank`, `learned.score/rank`, calibrated `confidence`, top candidate ids, disagreement reason, top contributing feature를 담는다.
- `outputs/_system/ml/runtime/structure-rank-v1-shadow-history/YYYY-MM-DD.jsonl`: runtime shadow scoring append-only history. 각 line은 `generatedAt`, `songId`, `snapshotId`, heuristic top, learned top, selected candidate, calibrated confidence, disagreement flag, reason, 관련 `scorePaths`를 담아 real runtime window reliability를 later summary에서 다시 계산할 수 있게 한다.
- `outputs/_system/ml/review-packs/learned-backbone/<packId>/pack.json`: learned backbone benchmark용 blinded pairwise review pack. reviewer-facing payload로서 `entryId`, optional `benchmarkId` or `planSignature`, blinded `variants[]`, decision options만 담고 worker or candidate identity는 숨긴다.
- `outputs/_system/ml/review-packs/learned-backbone/<packId>/answer-key.json`: 같은 pack의 internal mapping. 각 entry는 blinded label이 `learned_symbolic` 또는 `music21` 중 어느 쪽인지, source candidate id, source manifest path, source MIDI path, selected worker, selection mode를 담는다.
- `outputs/_system/ml/review-packs/learned-backbone/<packId>/results.json`: pairwise blind review ledger. operator 또는 외부 review surface가 `entryId`, `winnerLabel` (`A`, `B`, `tie`, `skip`), `reviewedAt`, optional reviewer metadata를 채우면 canonical learned-backbone benchmark summary가 이를 다시 읽어 `blindPreference` win rate와 reviewed pair counts, runtime selected worker가 decisive blind winner와 일치했는지 보는 `reviewedTop1Accuracy`, 그리고 selected attempt의 whole-piece candidate count와 same-attempt localized rewrite branch mix에서 유도한 `searchBudgetRows` (`S0/S1/S2/S3/S4/custom`)를 계산한다.

현재 runtime은 structure evaluation이 끝난 각 symbolic attempt마다 이 sidecar를 기록하고, 최종 선택이 확정되면 index와 candidate manifest의 `selected` 포인터를 갱신한다. `STRUCTURE_RERANKER_SHADOW_ENABLED=1`과 `STRUCTURE_RERANKER_SHADOW_SNAPSHOT=<snapshot>`가 켜져 있으면 runtime은 persisted candidate sidecar를 다시 읽어 `reranker-score.json`과 compact `shadowReranker` summary를 candidate manifest/index에 추가하고, 동시에 `_system/ml/runtime/structure-rank-v1-shadow-history/` 아래 append-only runtime history도 남긴다. canonical operator summary와 projection surface는 이 history와 review metadata를 다시 읽어 `shadowReranker.runtimeWindow`, `promotionOutcomes`, `promotionAdvantage`, `retryLocalizationOutcomes` aggregate를 계산한다. 여기서 `promotionAdvantage`는 approval and appeal delta를 그대로 보존하되, reviewed sample이 총 4건 미만이거나 promoted and heuristic cohort가 각각 2건 미만이면 `signal=insufficient_data`와 `sufficientReviewSample=false`를 함께 내려 sparse evidence를 보수적으로 표시한다. 추가로 `STRUCTURE_RERANKER_PROMOTION_ENABLED=1`이면 runtime은 같은 shadow snapshot을 이용해 아주 좁은 `string_trio` symbolic lane에서만 learned top candidate를 authoritative selection으로 승격할 수 있고, 실제 승격이 적용된 run은 selected candidate manifest와 index의 optional `rerankerPromotion` summary에 structured counterfactual evidence를 남긴다. 이때도 high-confidence disagreement와 기존 structure-pass plus explicit target guard를 모두 통과해야 하며 rollback은 그 flag를 다시 끄는 한 번의 설정 변경으로 끝난다. stdio/HTTP MCP의 canonical manifest surface는 계속 `outputs/<songId>/manifest.json`을 유지한다.
이 selected pointer, `selectionStopReason`, `rerankerPromotion`, attempt-local `revisionDirectives` truth-plane은 humanize, render, styled-audio 같은 후속 단계보다 먼저 기록된다. 따라서 later stage가 `PIPELINE_ERROR`로 끝나더라도 narrow-lane selection or promotion evidence와 attempt-2 targeted rewrite input context는 candidate sidecar에 그대로 남아 operator summary, dataset export, restart forensics가 같은 authoritative snapshot을 다시 읽을 수 있다.

## StructureEvaluationReport

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `passed` | `boolean` | 구조 평가 통과 여부 |
| `score` | `number?` | 0-100 규칙 기반 점수 |
| `issues` | `string[]` | 구조상 문제 목록 |
| `strengths` | `string[]` | 통과한 강점 목록 |
| `metrics` | `Record<string, number>?` | issueCount, registerPlanFit, cadenceApproachPlanFit, dynamicsPlanFit, articulationCharacterPlanFit, expressionPlanFit, orchestrationIdiomaticRangeFit, orchestrationRegisterBalanceFit, orchestrationConversationFit, orchestrationDoublingPressureFit, orchestrationTextureRotationFit, orchestrationSectionHandoffFit 등 수치 메트릭 |
| `longSpan` | `LongSpanEvaluationSummary?` | explicit `longSpanForm`이 있을 때 생성되는 compact operator summary. `status`(`held`, `at_risk`, `collapsed`), `weakestDimension`, 평균 fit, development or thematic or harmonic timing or return payoff fit를 함께 담아 pending approval와 operator summary surface가 긴 형식 유지 상태를 바로 읽을 수 있게 한다. |
| `orchestration` | `OrchestrationEvaluationSummary?` | constrained instrumentation plan이 있을 때 생성되는 compact ensemble-aware summary. 현재는 `string_trio` family의 range, register balance, conversational exchange, doubling pressure, texture rotation 결과를 담는다. |

section-level structure finding의 `metrics`에는 다음과 같은 artifact-aware 값이 들어갈 수 있다.

- `registerCenterFit`: 계획한 register center와 실제 결과의 일치도
- `registerCenterDrift`: 계획 대비 실제 register drift 크기
- `cadenceApproachFit`: 계획한 cadence approach와 실제 bass close의 일치도
- `dynamicsPlanFit`: 계획한 dynamics contour와 실제 `expressionDynamics`의 일치도
- `articulationPlanFit` / `characterPlanFit`: 태그 수준 articulation/character 일치도
- `articulationCharacterPlanFit`: articulation + character를 묶은 section-level expression fit
- `phrasePeakPlanFit`, `sustainBiasFit`, `accentBiasFit`: 세부 expression cue 일치도
- `expressionPlanFit`: dynamics/articulation/character/phrase/bias를 종합한 section-level expression 적합도
- `harmonicColorCoverageFit` / `harmonicColorTimingFit` / `harmonicColorTargetFit`: 계획한 harmonic color cue가 section artifact에서 tag, local window, target or resolution까지 얼마나 유지됐는지
- `harmonicColorPlanFit`: mixture, applied-dominant, predominant-color, suspension 같은 local color event가 section에서 얼마나 분명하게 살아남았는지에 대한 종합 점수
- `orchestrationRangeFit`: planned instrument family의 idiomatic range 안에 실제 role writing이 머무는 정도
- `orchestrationBalanceFit`: planned lead, middle, bass register stack이 section 안에서 얼마나 분명하게 유지되는지
- `orchestrationConversationFit`: conversational section에서 secondary instrument가 독립적인 응답 or exchange를 얼마나 유지하는지
- `orchestrationDoublingFit`: secondary or bass role이 lead를 pitch-class 단위로 과도하게 shadow하지 않고 독립성을 유지하는지
- `orchestrationTextureRotationFit`: 인접 section 진입에서 conversation, balance, spacing stance가 실제로 새 상태로 돌아서는지
- `orchestrationHandoffFit`: 인접 section에서 planned string-trio role rotation이 실제 register 이동으로 얼마나 분명하게 인계되는지

`longSpan.status`는 explicit long-span plan이 실제 평가에서 얼마나 유지됐는지의 compact 해석값이다.

- `held`: development pressure, thematic transformation, harmonic timing, return payoff가 모두 operator 기준선을 넘는다.
- `at_risk`: 일부 long-span fit가 기준선 아래로 떨어졌지만 전체 arc는 아직 부분적으로 유지된다.
- `collapsed`: return boundary 또는 payoff 같은 핵심 long-span fit가 심하게 약해졌거나, 여러 long-span 축이 동시에 무너져 localized retry 또는 human review를 우선 고려해야 한다.

## OrchestrationEvaluationSummary

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `family` | `"string_trio"` | 평가한 constrained ensemble family |
| `instrumentNames` | `string[]` | 계획 또는 유도된 instrument 이름 목록 |
| `sectionCount` | `number` | orchestration summary에 포함된 section 수 |
| `conversationalSectionCount` | `number` | `conversationMode="conversational"`로 평가된 section 수 |
| `idiomaticRangeFit` | `number?` | family-specific comfort range 안에서 역할이 유지된 정도 |
| `registerBalanceFit` | `number?` | lead, middle, bass stack 분리가 유지된 정도 |
| `ensembleConversationFit` | `number?` | conversational section에서 독립적 exchange가 유지된 정도 |
| `doublingPressureFit` | `number?` | secondary or bass role이 lead를 과도하게 doubling하지 않고 독립성을 유지한 정도 |
| `textureRotationFit` | `number?` | 인접 section 진입에서 conversation, balance, spacing state가 실제로 새 stance로 돌아선 정도 |
| `sectionHandoffFit` | `number?` | 인접 section 사이에서 lead, middle, bass duty handoff가 계획된 instrument rotation을 따라간 정도 |
| `weakSectionIds` | `string[]` | localized repair가 우선 필요한 section id 목록 |

현재 runtime은 `compositionPlan.orchestration`이 있거나, violin/viola/cello instrumentation과 section texture로부터 `string_trio` plan을 유도할 수 있을 때 이 summary를 채운다. quality loop는 `weakSectionIds`와 orchestration issue 문구를 이용해 기존 `expand_register` 또는 `clarify_texture_plan` directive를 section-local로 배치한다. 이제 trio plan은 section 내부에서 lead를 과도하게 shadow하는 doubling pressure도 `doublingPressureFit`으로 잡고, adjacent section entry에서 conversation, balance, spacing stance가 실제로 새 상태로 도는지 `textureRotationFit`으로 함께 점검하며, lead/secondary role을 회전시키면 `sectionHandoffFit`이 그 handoff가 실제 register 이동으로 남았는지도 함께 잡아낸다.

queue serialization, MCP job/operator summary, projection surfaces는 이 summary를 compact operator-facing 형태로 재노출할 수 있다. 현재 backlog or pending artifact line에서는 optional `orchestration=trio:rng=...,bal=...,conv=...,dbl=...,rot=...,weak=...` token을 쓸 수 있고, lean tracking payload에서는 `tracking.orchestration` 또는 `recentManifestTracking[].orchestration`으로 같은 정보를 유지한다. 또 successful-manifest aggregate는 `manifestAudioRetry.orchestrationTrends.familyRows[]`, canonical operator summary `artifacts[]`의 `orchestrationTrend family=...` line, 그리고 projection `latest.md`의 `## Orchestration Trends` section으로 재노출될 수 있다. 이 trend line은 optional `dbl=...`, `rot=...`, `hnd=...` token을 함께 붙여 recent successful manifest의 doubling, texture rotation, handoff pressure를 compact하게 보여 줄 수 있다. 별도로 phrase-breath survival aggregate는 `manifestAudioRetry.phraseBreathTrends`, canonical operator summary `artifacts[]`의 `phraseBreathTrend manifests=...` line, projection `latest.md`의 `## Phrase-Breath Trend` section, unattended sweep incident draft, shared pickup, `/mcp/health` compact diagnostics로 재노출될 수 있다. 이 signal은 harmony correctness나 timbre quality의 대체 지표가 아니라 recent successful manifest에서 pickup, arrival, release가 얼마나 잘 살아남는지 읽기 위한 값이다.

## AudioEvaluationReport

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `passed` | `boolean` | 오디오 산출물 평가 통과 여부 |
| `score` | `number?` | 0-100 산출물 완결성 점수 |
| `issues` | `string[]` | 누락/손상된 오디오 산출물 목록 |
| `strengths` | `string[]` | 생성된 오디오 산출물 강점 |
| `metrics` | `Record<string, number>?` | 파일 크기, 체크 통과 수, narrative fit, `audioTempoMotionPlanFit`, `audioHarmonicRealizationPlanFit` 같은 realized-evidence 메트릭 |
| `longSpan` | `AudioLongSpanEvaluationSummary?` | structure 쪽 `longSpan`과 별도로 rendered long-form survival을 요약하는 compact operator summary. `status`(`held`, `at_risk`, `collapsed`), `weakestDimension`, development or recap or harmonic-route or tonal-return fit를 담아 recent-job/backlog/operator projection이 rendered long-span collapse를 바로 읽을 수 있게 한다. |

`audioEvaluation.longSpan`은 rendered audio가 긴 형식 arc를 얼마나 유지했는지의 compact 해석값이다.

- `held`: development narrative, recap recall, harmonic route, tonal return이 모두 operator 기준선을 넘는다.
- `at_risk`: 일부 rendered long-span fit가 약하지만 development-to-return arc는 아직 부분적으로 들린다.
- `collapsed`: tonal return, recap recall, harmonic route 같은 핵심 rendered long-span 축이 무너지거나 여러 축이 동시에 약해져 operator review와 targeted retry를 우선 고려해야 한다.

operator-facing tracking, queue, pending-approval, and projection surfaces는 persisted manifest의 `structureEvaluation.longSpan`과 `audioEvaluation.longSpan`을 바탕으로 별도 computed `longSpanDivergence` summary를 합성할 수 있다. 이 값은 manifest 본문에 저장되지는 않지만, render가 symbolic hold보다 약할 때 `status`, `repairMode`, `repairFocus`, optional `secondaryRepairFocuses`, optional `recommendedDirectives[]`, `primarySectionId`, 그리고 `sections[]` explanation을 담아 어느 development 또는 recap 구간이 long-span collapse의 주 원인인지 보여 준다. `recommendedDirectives[]`는 primary와 secondary focus마다 `focus`, `kind`, `priorityClass`를 담아 quality loop가 실제로 사용할 multi-focus retry bundle을 downstream tooling에 그대로 노출한다. `repairMode`는 `render_only`, `paired_same_section`, `paired_cross_section` 중 하나이며, paired mode일 때 quality loop가 directive priority와 target section selection을 더 공격적으로 조정할 수 있다. operator-facing compact labels는 focus head에 `primaryFocus+secondaryFocus(+Nmore)`를 싣고, section 쪽은 `status:focus@sectionId`, `status:focus@sectionId~same`, `status:focus@audioSectionId>symbolicSectionId`로 축약하며, 추가 divergence section이 있으면 `,+sectionFragment`를 이어 backlog/pending digests에 싣는다. `sections[]`는 기본적으로 audio-side `topIssue`, `score`, `focusFit`, `consistencyFit`를 담고, symbolic long-span도 `at_risk` 또는 `collapsed`이면 optional `comparisonStatus="both_weak"`와 함께 `structureSectionId`, `structureTopIssue`, `structureScore`, `structureExplanation` 같은 paired symbolic section evidence도 실어 side-by-side 비교를 가능하게 한다.

## QualityControlReport

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `policy` | `ComposeQualityPolicy` | 적용된 자동 수정 정책 |
| `attempts` | `QualityAttemptRecord[]` | 구조 평가별 시도 이력 |
| `selectedAttempt` | `number?` | 최종적으로 채택된 시도 번호 |
| `stopReason` | `string?` | 루프 종료 사유 |

## QualityAttemptRecord

| 필드 | 타입 | 설명 |
| ---- | ---- | ---- |
| `attempt` | `number` | 1부터 시작하는 구조 시도 번호 |
| `passed` | `boolean` | 해당 시도가 구조 평가를 통과했는지 여부 |
| `score` | `number?` | 구조 점수 |
| `issues` | `string[]` | 해당 시도의 구조 문제 목록 |
| `strengths` | `string[]` | 해당 시도의 구조 강점 목록 |
| `directives` | `RevisionDirective[]` | 다음 시도를 위해 도출된 수정 지시 |
| `evaluatedAt` | `string` | 평가 시각 |

expression-aware quality loop에서는 `directives[].kind`에 `shape_dynamics`, `clarify_expression`, `shape_tempo_motion`, `shape_ornament_hold`가 포함될 수 있다. 구조 쪽 local harmonic craft가 약할 때는 전용 `clarify_harmonic_color`도 들어갈 수 있으며, 이 지시는 targeted section의 `harmonicPlan.colorCues`를 mixture, applied-dominant, predominant-color, suspension 가운데 하나 이상으로 다시 명시하고 local target or resolution을 보강한다. 이 지시는 다음 compose attempt의 section expression, section-local tempo motion, harmonic color, 또는 fermata 같은 local hold cue를 더 명시적으로 만들고, 갱신된 expression intent는 다시 `expression-plan.json`에 저장될 수 있다. `arpeggio`, `grace_note`, `trill`은 이제 audio evaluation에서 각각 `audioOrnamentArpeggioFit`, `audioOrnamentGraceFit`, `audioOrnamentTrillFit`까지 계산되지만 retry 대상은 아직 아니며, mordent와 turn 같은 broader ornament tag는 계속 `audioUnsupportedOrnamentSectionCount`와 `audioUnsupportedOrnamentTagCount`로 metadata-only preservation 상태만 노출한다.

## 예시

```json
{
  "songId": "2624672a-d10c-4bd6-9c1a-ac1964ef3608",
  "state": "DONE",
  "meta": {
    "songId": "2624672a-d10c-4bd6-9c1a-ac1964ef3608",
    "prompt": "비 오는 오후의 짧은 피아노 미니어처",
    "key": "C major",
    "tempo": 120,
    "form": "miniature",
    "source": "autonomy",
    "autonomyRunId": "df731177-43ee-4bf6-99b3-74c2ddffbdff",
    "promptHash": "fe19baa5e4124059",
    "workflow": "symbolic_plus_audio",
    "plannerVersion": "planner-schema-v2",
    "plannedSectionCount": 2,
    "plannerTelemetry": {
      "selectionStrategy": "novelty_plus_plan_completeness_v1",
      "selectedCandidateId": "underused_form_key",
      "selectedCandidateLabel": "Underused form/key",
      "selectedCandidateIndex": 0,
      "candidateCount": 3,
      "parserMode": "structured_json",
      "planSignature": "form=miniature|key=c major|meter=4/4|inst=piano|roles=theme_a>cadence|human=restrained",
      "noveltyScore": 0.91,
      "repeatedAxes": ["instrumentation"],
      "exactMatch": false,
      "selectionScore": 0.86,
      "qualityScore": 0.75
    },
    "createdAt": "2026-04-09T10:00:00.000Z",
    "updatedAt": "2026-04-09T10:00:05.000Z"
  },
  "artifacts": {
    "midi": "outputs/2624672a-.../composition.mid",
    "scoreImage": "outputs/2624672a-.../score-preview.svg",
    "audio": "outputs/2624672a-.../styled-output.wav",
    "renderedAudio": "outputs/2624672a-.../output.wav",
    "styledAudio": "outputs/2624672a-.../styled-output.wav"
  },
  "structureEvaluation": {
    "passed": true,
    "score": 100,
    "issues": [],
    "strengths": ["Rule-based symbolic structure checks passed."],
    "metrics": {
      "issueCount": 0,
      "orchestrationIdiomaticRangeFit": 0.91,
      "orchestrationRegisterBalanceFit": 0.88,
      "orchestrationConversationFit": 0.84,
      "orchestrationDoublingPressureFit": 0.81,
      "orchestrationTextureRotationFit": 0.77
    },
    "orchestration": {
      "family": "string_trio",
      "instrumentNames": ["violin", "viola", "cello"],
      "sectionCount": 3,
      "conversationalSectionCount": 1,
      "idiomaticRangeFit": 0.91,
      "registerBalanceFit": 0.88,
      "ensembleConversationFit": 0.84,
      "doublingPressureFit": 0.81,
      "textureRotationFit": 0.77,
      "weakSectionIds": []
    }
  },
  "audioEvaluation": {
    "passed": true,
    "score": 100,
    "issues": [],
    "strengths": ["Primary audio artifact is present.", "Rendered MIDI preview audio is available.", "Styled audio render is available."],
    "metrics": {
      "expectedChecks": 3,
      "passedChecks": 3
    }
  },
  "selfAssessment": {
    "generatedAt": "2026-04-09T10:00:18.000Z",
    "summary": "짧지만 일관된 마감감을 가진 미니어처로 평가되었다.",
    "qualityScore": 7.4,
    "strengths": ["명확한 종지감"],
    "weaknesses": ["중간부 대비 부족"],
    "tags": ["miniature", "reflective"],
    "raw": "{...}"
  },
  "approvalStatus": "pending",
  "evaluationSummary": "짧지만 일관된 마감감을 가진 미니어처로 평가되었다.",
  "runtime": {
    "stage": "DONE",
    "stageStartedAt": "2026-04-09T10:00:05.000Z",
    "updatedAt": "2026-04-09T10:00:18.000Z",
    "compose": {
      "worker": "music21",
      "phase": "completed",
      "updatedAt": "2026-04-09T10:00:02.000Z",
      "detail": "Symbolic composition finished",
      "outputPath": "outputs/2624672a-.../composition.mid"
    }
  },
  "stateHistory": [
    { "state": "IDLE", "timestamp": "2026-04-09T10:00:00.000Z" },
    { "state": "COMPOSE", "timestamp": "2026-04-09T10:00:01.000Z" },
    { "state": "CRITIQUE", "timestamp": "2026-04-09T10:00:02.000Z" },
    { "state": "HUMANIZE", "timestamp": "2026-04-09T10:00:03.000Z" },
    { "state": "RENDER", "timestamp": "2026-04-09T10:00:04.000Z" },
    { "state": "RENDER_AUDIO", "timestamp": "2026-04-09T10:00:04.400Z" },
    { "state": "STORE", "timestamp": "2026-04-09T10:00:04.700Z" },
    { "state": "DONE", "timestamp": "2026-04-09T10:00:05.000Z" }
  ],
  "updatedAt": "2026-04-09T10:00:05.000Z"
}
```

## `_system` 상태 파일

| 경로 | 설명 |
| ---- | ---- |
| `outputs/_system/preferences.json` | 최근 평가를 바탕으로 집계한 선호도/약점 메모리. motif return, tension arc, register center, cadence approach, bass motion, section style 성공 패턴과 최근 `planSignature` 기억을 포함한다. |
| `outputs/_system/runs/YYYY-MM-DD.json` | autonomy run ledger. preview/trigger 단계에서 `promptHash` 외에 `planSignature`, `noveltyScore`, 선택된 candidate의 `plannerTelemetry`가 함께 남을 수 있다. |
| `outputs/_system/state.json` | pause 상태와 active run lock |
| `outputs/_system/queue-state.json` | 재시작 복구용 queue snapshot |

`outputs/_system/preferences.json`의 autonomy memory에는 최근 성공 패턴으로 다음 필드가 누적될 수 있다.

- `successfulMotifReturns`
- `successfulTensionArcs`
- `successfulRegisterCenters`
- `successfulCadenceApproaches`
- `successfulBassMotionProfiles`
- `successfulSectionStyles`
- `recentPlanSignatures`

`outputs/<songId>/compose-progress.json`은 특히 MusicGen처럼 오래 걸리는 compose 단계의 worker heartbeat를 저장한다. 이제 explicit learned structure binding이 선택되면 narrow `string_trio` miniature slice에서 `worker="learned_symbolic"` progress가 기록될 수 있고, 해당 proposal이 unsupported lane 또는 worker error로 실패하면 runtime은 같은 `songId`에서 baseline `music21` path로 즉시 degrade한다.

symbolic render 경로에서는 `outputs/<songId>/score-preview.svg`가 기본 시각 산출물이다. expression plan이나 section artifact summary가 있는 경우 이 SVG에는 `Expression Profile` 패널이 함께 렌더될 수 있다. `outputs/<songId>/preview.mp4`는 ffmpeg와 WAV가 모두 준비된 경우에만 생긴다.

## 구현 위치

- 타입 정의: [`src/pipeline/types.ts`](../src/pipeline/types.ts)
- 저장/로드: [`src/memory/manifest.ts`](../src/memory/manifest.ts)
- 저장 경로: `outputs/<songId>/manifest.json`
- autonomy planner / approval 연결: [`src/autonomy/service.ts`](../src/autonomy/service.ts)
- queue snapshot 복구: [`src/queue/jobQueue.ts`](../src/queue/jobQueue.ts)
