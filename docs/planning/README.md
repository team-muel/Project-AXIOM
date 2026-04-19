# AXIOM Planning Index

이 디렉터리는 AXIOM runtime 자체의 전략 문서와 운영 runbook을 담는다.
문서가 많지 않으므로 삭제보다 읽기 순서와 상태 표식을 먼저 고정한다.

## Read First

매일 또는 설계 변경 직전에 먼저 볼 문서는 아래 순서로 고정한다.

1. [multimodel-composition-pipeline.md](multimodel-composition-pipeline.md)
   - 음악적 방향, 품질 계약, symbolic path의 현재 한계, learned reranker or learned compose worker 확장 로드맵을 설명하는 전략 문서
2. [truth-plane-dataset-design.md](truth-plane-dataset-design.md)
   - 현재 manifest, sidecar, review truth-plane을 backbone or rewrite or reranker 학습용 데이터셋으로 바꾸는 설계 문서
3. [backbone-search-reranker-matrix.md](backbone-search-reranker-matrix.md)
   - backbone, search budget, reranker 정책을 같은 narrow lane에서 비교하는 실험 매트릭스
4. [external-repository-stack.md](external-repository-stack.md)
   - 사용자가 제안한 9개 외부 repo를 core, support, operations 층으로 나누어 AXIOM 역할별로 정리한 상위 reference 문서
5. [symbolic-backbone-reference.md](symbolic-backbone-reference.md)
   - AXIOM이 참고할 외부 symbolic backbone 후보, 제어형 재생성 참고 모델, theory-engine 축을 역할별로 정리한 subset reference 문서
6. [gcpcompute-axiom-integration.md](gcpcompute-axiom-integration.md)
   - AXIOM truth plane, gcpCompute control plane, bridge plane 역할 분리를 설명하는 운영 설계 문서
7. [gcpcompute-shared-adoption-plan.md](gcpcompute-shared-adoption-plan.md)
   - shared runtime mirror consumption, shared-only bootstrap, `/mcp/health` diagnostics 도입 계획과 현재 구현 범위
8. [../autonomy-operations.md](../autonomy-operations.md)
   - autonomy scheduler, approval, recovery, 운영 규칙의 정본
9. [../state-machine.md](../state-machine.md)
   - 파이프라인 상태, 산출물, 복구 단계의 정본
10. [../manifest-schema.md](../manifest-schema.md)
    manifest와 artifact contract의 정본

## Operator Runbooks

아래 문서는 전략 문서가 아니라 gcpCompute 또는 team operator 절차용 runbook이다.

1. [gcpcompute-operator-projection-runbook.md](gcpcompute-operator-projection-runbook.md)
   - `ops:project` 주기 실행과 operator summary projection 설정
2. [gcpcompute-safe-unattended-sweep-runbook.md](gcpcompute-safe-unattended-sweep-runbook.md)
   - `ops:sweep` 기반 unattended 상태 점검과 triage 절차
3. [gcpcompute-shadow-governance-runbook.md](gcpcompute-shadow-governance-runbook.md)
   - 정책 변경 전 shadow review 절차
4. [gcpcompute-shared-pickup-runbook.md](gcpcompute-shared-pickup-runbook.md)
   - `ops:pickup` handoff bundle 생성 및 shared pickup 절차

## Active Design Docs

아래 문서는 전략보다 한 단계 더 내려간 구현 설계 문서다.
현재 learned backbone and localized rewrite work를 실제 코드 변경으로 옮길 때 먼저 읽는다.

1. [notagen-class-adapter-design.md](notagen-class-adapter-design.md)
   - NotaGen-class learned symbolic backbone을 `learned_symbolic` slot에 붙이기 위한 adapter, normalization, fallback, truth-plane 설계
2. [deepbach-style-localized-rewrite-design.md](deepbach-style-localized-rewrite-design.md)
   - DeepBach-style constrained regeneration을 AXIOM `revisionDirectives`, section window, candidate sidecar 계약에 매핑하는 설계

읽기 규칙:

1. 구조와 방향을 바꿀 때는 전략 문서를 먼저 읽는다.
2. 실제 learned backbone or rewrite 구현을 시작할 때는 위 design docs를 전략 문서 다음으로 읽는다.
3. systemd, unattended, projection, bridge 운용을 건드릴 때만 runbook을 읽는다.
4. runbook은 상태 결정 문서가 아니라 절차 문서로 취급한다.

## Reference And Completed

- [gm-soundfont-rollout.md](gm-soundfont-rollout.md)
  - 완료된 timbre rollout 기록과 benchmark reference

이 문서는 현재 활성 계획이 아니라 완료된 결정과 재생성 절차를 남기는 reference다.

## Evidence Only

- [gate-runs/README.md](gate-runs/README.md)
  - planning tree 아래의 dated evidence와 test result index

`gate-runs/` 아래 문서는 현재 우선순위를 정하는 planning 문서가 아니라 audit, 회고, 재검증용 증거 문서로만 취급한다.

## External Integration Notes

이 planning tree는 현재 워크스페이스에서 유지하는 유일한 planning index다.
외부 bridge, knowledge plane, social ops 문서는 로컬 sibling repo를 전제하지 않고 통합 대상 또는 원격 운영면으로만 취급한다.

역할 분리:

1. 이 디렉터리는 AXIOM runtime, gcpCompute operator, MCP compatibility planning의 정본이다.
2. 외부 bridge 또는 knowledge plane 가정이 필요하면 개별 runbook 안에 integration note로만 남기고 별도 sibling planning tree를 전제하지 않는다.
3. 원격 bridge가 존재해도 AXIOM truth plane과 운영 계약의 source of truth는 계속 이 디렉터리와 상위 docs에 둔다.

## Reduction Rules

1. 새 AXIOM planning 문서를 만들기 전에 위 Read First 문서 중 어디에 흡수할지 먼저 판단한다.
2. 전략 변경은 `multimodel-composition-pipeline.md` 또는 `gcpcompute-axiom-integration.md`에만 남긴다.
3. 절차 추가는 개별 runbook에만 남기고 전략 문서와 중복 서술하지 않는다.
4. 결과 보고서와 단발성 검증은 `gate-runs/` 아래로 보낸다.
5. 완료된 rollout 문서는 삭제하지 말고 status를 명시한 reference로 유지한다.
