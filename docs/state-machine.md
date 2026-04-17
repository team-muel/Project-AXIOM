# 파이프라인 상태 머신

AXIOM 작곡 파이프라인의 상태 정의와 전이 규칙.

중요: `approval`은 `PipelineState`가 아니라 manifest metadata(`approvalStatus`)로 관리된다.  
즉, 파이프라인은 `DONE`으로 끝나더라도 autonomy run은 별도로 `pending approval` 상태일 수 있다.

승인 또는 반려가 확정되면 manifest에는 `reviewFeedback`가 추가될 수 있고, 같은 정보가 `outputs/_system/preferences.json`의 `humanFeedbackSummary` 집계로도 반영된다. 같은 preferences 파일에는 성공한 autonomy run에서 추출한 harmonic behavior memory도 누적되며, 여기에는 `prolongationMode`와 measure 범위를 제거한 `tonicizationWindows` 요약이 포함될 수 있다.

## 상태 목록

| 상태 | 설명 |
| ---- | ---- |
| `IDLE` | 파이프라인 시작 전 초기 상태 |
| `COMPOSE` | 심벌릭 작곡 진행 중 (MIDI/스코어 생성) |
| `CRITIQUE` | 화성·형식 검수 진행 중 |
| `HUMANIZE` | 루바토·벨로시티·프레이징 적용 중 |
| `RENDER` | SVG 악보 미리보기 생성, 선택적 WAV/preview MP4 렌더 중 |
| `RENDER_AUDIO` | `symbolic_plus_audio` 경로에서 styled audio 추가 렌더 및 오디오 평가 직전 단계 |
| `STORE` | 산출물 및 manifest 최종 저장 |
| `DONE` | 파이프라인 정상 완료 (종료 상태) |
| `FAILED` | 실패 (종료 상태) |

## 전이 규칙

```text
IDLE      → COMPOSE
COMPOSE   → CRITIQUE, STORE, FAILED
CRITIQUE  → COMPOSE (structure 수정 재시도), HUMANIZE, FAILED
HUMANIZE  → RENDER, COMPOSE, FAILED
RENDER    → RENDER_AUDIO, STORE, COMPOSE, FAILED
RENDER_AUDIO → STORE, COMPOSE (audio 피드백 기반 재시도), FAILED
STORE     → DONE, FAILED
DONE      → (종료)
FAILED    → (종료)
```

중요: `COMPOSE → STORE`는 audio-first/MusicGen 경로에서만 쓰인다. 이 경우 compose 단계 내부에서 이미 오디오 평가까지 끝낸 뒤 저장 단계로 넘어간다.

또한 symbolic 경로에서도 `HUMANIZE`, `RENDER`, `RENDER_AUDIO` 중간 단계에서 restart recovery가 일어나면 직전 체크포인트를 기준으로 재개하거나, 필요한 경우 `COMPOSE`로 되돌아가 다시 시도한다.

### Audio-first fast-path

MusicGen 또는 `audio_only` execution plan은 오디오를 직접 생성하므로 다음 단축 경로를 탄다.

```text
IDLE → COMPOSE → STORE → DONE
```

이 경우 `CRITIQUE`, `HUMANIZE`, `RENDER`, `RENDER_AUDIO`는 건너뛴다.

단, audio evaluation은 `COMPOSE` 내부에서 즉시 수행되며, 오디오 평가나 목표 점수를 만족하지 못하면 `STORE`로 가지 않고 바로 `FAILED`로 끝날 수 있다.

현재 audio-first fast-path는 오디오 중심 경로이므로 `score-preview.svg`와 `preview.mp4`를 만들지 않는다.

또한 compose 중에는 `outputs/<songId>/compose-progress.json`에 `loading_model`, `preparing_inputs`, `generating`, `saving_output`, `completed` 같은 내부 heartbeat가 기록된다.

### Symbolic revision loop

symbolic 계열(`symbolic_only`, `symbolic_plus_audio`)은 한 번의 직선 파이프라인이 아니라 품질 루프를 가진다.

```text
COMPOSE → CRITIQUE → COMPOSE → ...
```

- `CRITIQUE`는 규칙 기반 structure evaluation을 만들고, 필요하면 revision directives를 생성한다.
- revision directives가 있으면 `COMPOSE`로 되돌아가 다음 attempt를 만든다.
- 각 시도의 평가와 directive는 `qualityControl.attempts[]`에 누적된다.
- 최종적으로 채택된 시도는 `qualityControl.selectedAttempt`에 기록된다.

expression-aware symbolic loop에서는 `section-artifacts.json`의 realized phrase/texture/expression summary를 planner의 `textureDefaults`, section `phraseFunction`/`texture`, `expressionDefaults`/section `expression`과 함께 읽어 `phraseFunctionFit`, `texturePlanFit`, `textureIndependenceFit`, `imitationFit`, `counterpointBehaviorFit`, `expressionPlanFit` 같은 survival/proxy metric을 계산한다. 이 비교가 약하면 `clarify_phrase_rhetoric`, `clarify_texture_plan`, `shape_dynamics`, `clarify_expression` directive가 생길 수 있고, 갱신된 phrase/texture/expression intent는 `expression-plan.json`에 함께 저장되어 다음 attempt와 restart recovery에 재사용된다. `clarify_texture_plan`이 section-targeted로 남은 symbolic keyboard section은 worker가 그 section만 더 line-like한 accompaniment counterline bias로 다시 렌더하고, 나머지 section은 기존 `sectionArtifacts`를 그대로 재사용할 수 있다. humanize 단계도 같은 sidecar의 `startMeasure`/`endMeasure` window를 읽어 section-local role-aware timing/velocity/sustain shaping을 적용하고, shared accompaniment track 안에서는 bass와 upper strand를 register/event heuristic으로 갈라 다룬다. 또한 explicit `inner_voice` 또는 `counterline` 악기와 별도 `bass` 악기가 함께 주어진 짧은 chamber-like texture에서는, 최종 symbolic score가 tagged secondary strand를 별도 MIDI part로 분리해 출력할 수 있다. 이 경우에도 section artifact 계약은 유지되며 secondary strand evidence는 계속 `accompanimentEvents` 태그에서 계산되고, humanize 뒤에는 `tempoMotionSummary`가 추가되어 이후 audio evaluation이 cue coverage를 다시 읽을 수 있다.

`symbolic_plus_audio`는 여기에 audio-informed retry가 한 번 더 붙을 수 있다.

```text
... → HUMANIZE → RENDER → RENDER_AUDIO → COMPOSE → ...
```

- `RENDER_AUDIO` 이후 audio evaluation이 약하면 audio revision directives를 만들고 다시 `COMPOSE`로 되돌아간다.
- 즉, 이 상태 머신의 실제 루프는 structure loop와 audio loop가 모두 `COMPOSE`를 중심으로 닫힌다.

### 현재 루프의 보장 범위

현재 symbolic revision loop는 다음을 강화하는 데에는 의미가 있다.

- cadence strength와 종지 접근
- tonal return과 section harmonic route
- outer-voice parallel perfect 경고 완화
- section-local tension contour
- planner가 준 phrase/texture/expression cue의 생존 여부

하지만 이 루프가 아직 보장하지 않는 것도 분명하다.

- sentence, period, continuation 같은 phrase rhetoric의 완성도
- 지속적인 inner-voice independence
- 본격적인 contrapuntal texture나 invertible counterpoint
- 장기적인 orchestral conversation이나 texture rotation

또한 `audio_only` fast-path는 이 symbolic loop의 대부분을 건너뛰므로, 같은 `DONE`이라도 음악적 해석 신뢰도는 symbolic lane과 다르게 봐야 한다.

### 다이어그램

```text
┌──────┐
│ IDLE │
└──┬───┘
   ▼
┌─────────┐
│ COMPOSE │◄─────────────────────────────┐
└──┬──────┘                              │
   ▼                                     │
┌──────────┐   structure retry           │
│ CRITIQUE │─────────────────────────────┘
└──┬───────┘
   │ pass=true
   ▼
┌──────────┐
│ HUMANIZE │
└──┬───────┘
   ▼
┌────────┐
│ RENDER │
└──┬─────┘
   ├──────────────► STORE ─► DONE
   │
   ▼
┌──────────────┐
│ RENDER_AUDIO │
└──────┬───────┘
       ├──────────────► STORE
       │
       └──────────────────────────────► COMPOSE

※ COMPOSE ~ STORE 어디서든 에러 발생 시 → FAILED
※ `symbolic_only`는 `RENDER → STORE`
※ `symbolic_plus_audio`는 `RENDER → RENDER_AUDIO → STORE`
※ `audio_only`는 `COMPOSE` 내부 audio evaluation 완료 후 `STORE`
```

## 품질 루프와 채택 규칙

- structure evaluation은 각 symbolic attempt마다 계산된다.
- 실패한 attempt라도 더 나은 section score를 가진 draft면 best symbolic candidate로 유지될 수 있다.
- retry가 끝나면 가장 강한 symbolic candidate가 후속 `HUMANIZE/RENDER` 단계로 넘어간다.
- audio evaluation 역시 각 attempt에 기록되고, 마지막 종료 사유는 `qualityControl.stopReason`에 저장된다.
- 명시된 structure/audio target 점수를 끝까지 못 맞추면 통과한 draft가 있어도 `FAILED`로 종료될 수 있다.

## autonomy 운영 레이어

파이프라인 위에는 별도의 autonomy 운영 레이어가 있다.

1. planner가 다음 작곡 요청 초안을 만든다.
2. run ledger와 active run lock이 중복 실행을 막는다.
3. queue가 실제 파이프라인을 실행한다.
4. 완료된 autonomy 곡은 `approvalStatus=pending`으로 남는다.
5. 사람이 `approve` 또는 `reject`를 호출한다.

즉, 운영 레이어의 상태는 대략 아래 순서를 가진다.

```text
previewed
   → queued
   → running
   → retry_scheduled (선택)
   → pending_approval
   → approved | rejected

실패 시 어느 단계에서든 → failed
```

이 정보는 manifest와 별도로 다음 파일에 저장된다.

- `outputs/_system/runs/YYYY-MM-DD.json` — autonomy run ledger
- `outputs/_system/state.json` — pause / activeRun lock
- `outputs/_system/queue-state.json` — queue snapshot 및 restart recovery 기준점
- `outputs/_system/operator-actions/latest.json` 및 `history/YYYY-MM-DD.jsonl` — 허용된 operator mutation(`pause`, `resume`, `reconcile_lock`, `approve`, `reject`)의 최신 snapshot과 append-only audit log. 필요하면 `rollbackNote`, `manualRecoveryNote`까지 함께 남겨 후속 복구 판단 근거로 사용한다.

## Remote Operator Diagnostics

상태의 source of truth는 계속 local AXIOM runtime과 `outputs/_system/`에 남는다.
다만 remote operator와 shared gcpCompute smoke check를 위해 별도 diagnostics surface를 둔다.

- `GET /health` — 최소 liveness
- `GET /ready` — symbolic/audio capability readiness
- `GET /mcp/health` — MCP transport readiness, auth posture, tool catalog, queue summary, latest `operator-summary` / `operator-sweep` / `incident-drafts` / `operator-pickup` artifact 존재 여부와, artifact가 phrase-breath trend 또는 orchestration trend snapshot을 갖고 있을 때 compact availability/pressure summary 및 짧은 advisory 문구

이 surface는 bootstrap과 remote diagnostics를 위한 읽기 전용 요약면일 뿐이며, queue/autonomy/manifests의 source of truth를 대체하지 않는다.

## 각 상태별 입출력

### IDLE → COMPOSE

- **입력**: `ComposeRequest` (prompt, key?, tempo?, form?, workflow?, compositionPlan?, compositionSketch?, revision directives?)
- **출력**: symbolic draft 또는 pre-rendered audio 초안 + planning metadata
- **실패 시**: `FAILED` (작곡 엔진 오류)

### COMPOSE → CRITIQUE

- **적용 대상**: symbolic workflow만 해당
- **입력**: compose가 만든 MIDI 데이터 + section plan + section artifacts + hydrate된 phrase/texture/expression intent
- **출력**: `StructureEvaluationReport`, section findings, weakest sections, structure revision directives
- **phrase/texture/expression 평가**: `section-artifacts.json`의 `phraseFunction`/texture summary와 `expressionDynamics`/`articulation`/`character`/bias 요약을 planner의 phrase/texture/expression plan과 비교해 `phraseFunctionFit`, `texturePlanFit`, `textureIndependenceFit`, `imitationFit`, `counterpointBehaviorFit`, `expressionPlanFit` survival metric을 계산하고, 필요 시 `clarify_phrase_rhetoric`, `clarify_texture_plan`, `shape_dynamics`, `clarify_expression` directive를 만든다. `textureIndependenceFit`, `imitationFit`, `counterpointBehaviorFit`은 heuristic secondary-line motion과 source-motif relation 요약을 쓰므로, 완전한 phrase rhetoric이나 contrapuntal independence를 증명하지는 않는다. 다만 section-targeted `clarify_texture_plan` retry는 symbolic keyboard texture에서 해당 section만 더 독립적인 counterline-like accompaniment로 밀어줄 수 있다.
- **pass=true 또는 best candidate 채택**: `HUMANIZE`로 전이
- **retry 필요**: `COMPOSE`로 복귀 (수정 재시도)
- **target 미달 또는 시도 소진**: `FAILED`

### CRITIQUE → HUMANIZE

- **입력**: 채택된 symbolic candidate의 MIDI + hydrate된 `expression-plan.json`(있을 때)
- **출력**: 인간화 적용된 MIDI 데이터
- **expression 전달**: humanizer는 `humanizationStyle`, 전역 texture/expression defaults, 전역 `tempoMotionDefaults`, 전역 `ornamentDefaults`, section별 `startMeasure`/`endMeasure` window와 phrase/texture/expression/tempo-motion/ornament cue를 받아 lead와 secondary voice의 timing/velocity/sustain shaping을 다르게 적용한다. 두 파트 MIDI에서는 한 accompaniment part 안에 bass와 upper strand가 함께 있더라도 register/event heuristic으로 role을 갈라 적용한다. 같은 sidecar의 section별 `phraseBreath`는 이제 재시작 복구와 retry 이후에도 유지될 뿐 아니라 humanize의 local timing profile에 합성되어 pickup or preparation 구간의 약한 anticipatory press-forward, arrival의 broadening, release의 easing, rubato anchor의 국소 stretch, cadence recovery의 partial reset을 만들 수 있다. 현재 이 경로는 `tenuto`/`sostenuto`/`staccatissimo`/`marcato`와 `tranquillo`/`grazioso`/`energico` 같은 확장 articulation/character tag를 길이, velocity scale, ending stretch 차이로 실재화할 수 있고, `ritardando`/`rallentando`/`allargando`/`accelerando`/`stringendo`/`a_tempo`/`ritenuto`/`tempo_l_istesso` 같은 tempo-motion cue도 section-local duration and jitter shaping으로 반영할 수 있다. ornament contract는 현재 `grace_note`/`trill`/`mordent`/`turn`/`arpeggio`/`fermata`를 구조적으로 보존하며, 이 가운데 `fermata`는 target beat 또는 section-final event를 기준으로 local hold로, `arpeggio`는 explicit local window plus target beat가 있는 chord event를 기준으로 rolled onset으로, `grace_note`는 explicit local window plus target beat가 있는 note event를 기준으로 short lead-in으로, `trill`은 explicit local window plus target beat가 있는 note event를 기준으로 upper-neighbor oscillation으로 먼저 실재화한다. humanize 결과는 각 section별 `phraseBreathSummary`, `tempoMotionSummary`, `ornamentSummary`를 함께 남겨 phrase-breath coverage, pickup or arrival or release or recovery timing evidence, targeted measure coverage, realized note activity, direction, local hold coverage, sustain contrast, arpeggio onset spread evidence, grace-note lead-in evidence, trill oscillation evidence를 후속 audio evaluation에 전달한다. quality loop는 이 phrase-breath evidence를 읽어 weak pickup or arrival or release section을 localized `clarify_phrase_rhetoric` retry로 다시 밀 수 있다.
- **재시작 복구 시**: 기존 `composition.mid`가 있으면 여기서 재개, 없으면 `COMPOSE`로 복귀
- **실패 시**: `FAILED`

### HUMANIZE → RENDER

- **입력**: 인간화된 MIDI 데이터 + phrase/texture/expression plan + section artifacts + section labels
- **출력**: `RenderResult` (artifacts: midi, scoreImage, audio?, video? 경로)
- **기본 산출물**: `score-preview.svg`
- **expression 시각화**: render는 texture defaults, expression defaults, tempo-motion defaults, ornament defaults, section phrase/texture/expression/tempo-motion/ornament cue, section velocity range를 요약한 `Expression Profile` 패널을 score preview에 추가할 수 있다.
- **선택 산출물**: `output.wav`는 SoundFont가 있을 때, `preview.mp4`는 ffmpeg와 WAV가 있을 때 생성
- **재시작 복구 시**: `humanized.mid`가 있으면 여기서 재개, 없으면 이전 symbolic checkpoint로 후퇴
- **실패 시**: `FAILED`

### RENDER → RENDER_AUDIO

- **적용 대상**: `symbolic_plus_audio`
- **입력**: render artifact + request/planner metadata
- **출력**: styled audio artifact
- **artifact 계약**: `audio`는 score-aligned rendered WAV를 유지하고, prompt-regenerated 결과는 `styledAudio`에만 저장한다.
- **expression 전달**: styled audio prompt는 원문 prompt에 더해 `textureDefaults`, `tempoMotionDefaults`, `ornamentDefaults`, section-level phrase/texture cue, `expressionDefaults`, section-level expression cue, section-level tempo motion cue, section-level ornament cue를 직렬화해 MusicGen 입력에 포함할 수 있다.
- **이후 처리**: audio evaluation 수행. 이 단계는 `section-artifacts.json`의 `tempoMotionSummary`와 `ornamentSummary`를 함께 읽어 `audioTempoMotionPlanFit`, `audioOrnamentPlanFit`, `audioOrnamentArpeggioFit`, `audioOrnamentGraceFit`, `audioOrnamentTrillFit` 같은 metric을 계산하고, cue coverage나 local hold contrast가 약하면 `shape_tempo_motion` 또는 `shape_ornament_hold` directive를 만들어 다시 `COMPOSE`로 되돌릴 수 있다. `arpeggio`, `grace_note`, `trill`은 현재 scored cue이지만 retry 대상은 아니고, 아직 explicit realization이 없는 ornament tag는 failure로 오판하지 않고 `audioUnsupportedOrnamentSectionCount` 같은 metadata-only metric으로만 남긴다.
- **audio retry 필요**: `COMPOSE`로 복귀
- **재시작 복구 시**: 기존 `output.wav`가 있으면 styled audio 단계에서 재개 가능
- **실패 시**: `FAILED`

### RENDER 또는 RENDER_AUDIO → STORE → DONE

- **입력**: 산출물 경로
- **출력**: manifest 최종 저장, `qualityControl.selectedAttempt`/`stopReason` 확정
- **symbolic_only**: `RENDER → STORE`
- **symbolic_plus_audio**: `RENDER_AUDIO → STORE`
- **audio_only**: `COMPOSE` 내부 audio evaluation 완료 후 `STORE`
- **실패 시**: `FAILED`

### DONE 이후 autonomy 후처리

- autonomy run이면 `approvalStatus=pending`으로 남는다.
- Gemma self-assessment가 가능하면 `selfAssessment`와 `evaluationSummary`를 채운다.
- self-assessment가 실패해도 autonomy preferences memory는 갱신된다.
- 성공한 run의 경우 motif return, tension arc, register center, cadence approach, bass motion, section style, phrase function, texture/counterpoint, harmonic behavior memory가 갱신될 수 있다. harmonic behavior memory는 pacing/voicing뿐 아니라 `prolongationMode`와 measureless `tonicizationWindows` 요약도 함께 보존할 수 있다.
- 사람이 `approve` 또는 `reject`를 호출하면 `reviewFeedback`와 `evaluationSummary`가 갱신되고, `humanFeedbackSummary`가 planner memory용으로 다시 집계된다.
- 사람이 승인 또는 반려하기 전까지 새 autonomy trigger는 차단될 수 있다.

## 실패 처리

실패 시 manifest에 기록되는 필드:

```json
{
  "state": "FAILED",
  "errorCode": "CRITIQUE_REJECTED",
  "errorMessage": "parallel fifths detected; missing cadence",
  "stateHistory": [
    { "state": "IDLE", "timestamp": "..." },
    { "state": "COMPOSE", "timestamp": "..." },
    { "state": "CRITIQUE", "timestamp": "..." },
    { "state": "FAILED", "timestamp": "..." }
  ]
}
```

실패 코드는 실제로 `CRITIQUE_REJECTED`, `STRUCTURE_TARGET_NOT_MET`, `AUDIO_EVALUATION_FAILED`, `AUDIO_TARGET_NOT_MET` 같은 품질 루프 종료 사유를 가질 수 있다.

## restart recovery

프로세스가 재시작되면 queue snapshot과 control state를 읽어 다음을 수행한다.

1. `queued` 작업은 다시 메모리 queue에 올린다.
2. `retry_scheduled` 작업은 `nextAttemptAt`을 기준으로 타이머를 복구한다.
3. 재시작 직전 `running`이던 작업은 `queued`로 되돌려 다시 시도한다.
4. stale autonomy lock은 manifest와 ledger를 비교해 정리한다.

특히 pipeline 자체도 마지막 symbolic checkpoint를 기준으로 재개를 시도한다.

- `HUMANIZE`: 기존 `composition.mid`와 structure evaluation이 있으면 humanize부터 재개
- `RENDER`: 기존 `humanized.mid`가 있으면 render부터 재개, 없으면 한 단계 뒤로 후퇴
- `RENDER_AUDIO`: 기존 score-aligned `output.wav`가 있으면 styled audio부터 재개
- `STORE`: 이미 audio evaluation이 있으면 바로 finalize, 없으면 이전 단계로 후퇴

이때 `expression-plan.json`이 남아 있으면 recovery는 이 sidecar를 먼저 hydrate하여 recovered request의 `compositionPlan`에 merge한다. 따라서 humanize/render/styled-audio/revision loop는 재시작 뒤에도 같은 expression intent를 계속 사용한다.

이때 compose 단계에서 재시작된 job은 기존 manifest의 `songId`를 재사용한다. `qualityControl.selectedAttempt`가 이미 있으면 그 시도 번호를 기준으로 recovery가 이어질 수 있다. audio-first/MusicGen 경로에서 이미 `output.wav`가 완성돼 있으면 같은 디렉터리를 읽어 즉시 복구 완료 처리한다.

이 레이어는 완전한 분산 durable queue는 아니지만, 단일 프로세스 재시작 복구를 제공한다.

## 구현 위치

- 상태 enum / 전이 함수: [`src/pipeline/states.ts`](../src/pipeline/states.ts)
- 오케스트레이터: [`src/pipeline/orchestrator.ts`](../src/pipeline/orchestrator.ts)
- autonomy 운영 서비스: [`src/autonomy/service.ts`](../src/autonomy/service.ts)
- autonomy scheduler: [`src/autonomy/scheduler.ts`](../src/autonomy/scheduler.ts)
- queue persistence / recovery: [`src/queue/jobQueue.ts`](../src/queue/jobQueue.ts)
