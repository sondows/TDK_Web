<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TDKON 개발 규칙

- 기존에 확정된 TDKON 정책과 정상 동작을 유지한다. 기능 변경 전에 현재 코드와 영향 범위를 확인한다.
- 프로그램 경로는 POS `/tdkpos`, ADM `/tdkadm`, KDS `/tdkkds`이다. HOS는 향후 개발 대상이다.
- 운영 DB는 `TDK_POS`, 개발·검증 DB는 `TDK_POS_TEST`이다. 운영 DB 변경과 운영 배포는 사용자 승인 없이는 진행하지 않는다.
- 기존 정상 기능을 보호하고, 불필요한 DB 테이블을 생성하지 않는다. 인증 우회나 권한 검증 제거를 금지한다.
- 인증 보안 정책 변경, 대규모 데이터 삭제도 사용자 승인 후 진행한다.
- 복잡한 작업은 먼저 `PLANS.md`에 작은 순차 단계로 나눈다. 각 단계에서 기존 코드 분석 → 필요한 부분만 수정 → 관련 테스트 → 결과 확인 순서를 지킨다.
- 관련 테스트가 통과한 단계만 `PASS`로 기록하고 다음 단계로 진행한다. 실제로 검증하지 않은 작업은 완료로 표시하지 않는다.
- 단계 상태는 `TODO`, `IN_PROGRESS`, `PASS`, `BLOCKED` 중 하나를 사용한다. 실패 시 해당 단계에서 원인을 수정하고 재검증한다.
- 오류가 나면 실행 코드, 개발 DB 상태, API 요청·응답, 화면 상태, 기존 인증 로직, 테스트 환경, 실제 배포 여부를 확인한다. 같은 문제가 두 번 반복되면 기능 개발을 멈추고 근본 원인을 분석한다.
- 완료 단계마다 Git 커밋 또는 복구 가능한 체크포인트를 남긴다. 검증된 이전 단계는 실패한 다음 단계 때문에 되돌리지 않는다.
- 대화가 중단되면 `PLANS.md`의 마지막 `PASS` 다음 단계에서 재개한다. 사용자가 "계속 진행해줘"라고 요청하면 남은 단계를 순서대로 진행한다.
