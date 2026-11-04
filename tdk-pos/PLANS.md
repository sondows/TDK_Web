# TDKON 단계별 개발 계획

## 사용법과 상태 기준

새 개발 목표를 받으면 현재 코드와 DB 의존성을 먼저 분석하고 이 표를 목표에 맞게 갱신한다. 각 단계에는 코드 분석, 최소 수정, 관련 테스트, 결과 확인을 순서대로 기록한다. `PASS`는 실제 검증 결과와 복구 지점을 남긴 경우에만 부여한다. 문제가 나면 해당 단계에서 원인을 수정하고 다시 검증한다. 같은 문제가 두 번 반복되면 다음 기능 단계로 넘어가지 않고 실행 코드·DB·API·화면·인증 로직·환경·배포 상태를 확인한다.

현재 목표: ADM 최초 인증 문제를 해결하고 POS·ADM·KDS 인증 흐름을 순차적으로 검증한다. HOS는 향후 개발 대상이다. 운영 DB `TDK_POS`의 변경, 인증 보안 정책 변경, 대규모 삭제, 운영 배포는 사용자 승인 후 진행한다. 개발 DB는 `TDK_POS_TEST`이다.

## 현재 기준선

- 2026-10-30: 기존 작업 트리에 프로그램 신뢰 토큰·마스터 비밀번호 복구 관련 수정 및 미추적 파일이 다수 존재한다. 이 코드는 단계별 검증 기록이 없어 완료로 간주하지 않는다.
- 앞선 점검에서 프로덕션 빌드와 TypeScript 검사는 통과했다. 변경 파일 대상 ESLint는 통과했으며, 전체 소스 ESLint에는 기존 파일의 오류가 남아 있다. 이 결과는 아래 개별 단계의 `PASS` 근거가 아니다.
- 인증 흐름과 DB 전환 설명은 `docs/program-trust-rollout.md`에 있다. 운영 DB와 NAS 배포는 진행하지 않았다.

## ADM 최초 인증 단계

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 기존 ADM 계정 및 마스터 비밀번호 상태 확인 | `scripts/check-owner-first-auth-test.cjs`, `TDK_POS_TEST` 읽기 전용 조회, 계획 기록 | 개발 DB 연결 및 계정 식별 | 조회 결과와 이후 복구 분기 | 대상 계정·최고관리자 권한·비밀번호 해시·PIN·잠금·복구 권한 상태를 확인하고 결과 기록 | 읽기 전용 스크립트 실행 및 조회 항목 확인 | PASS |
| 2 | ID 입력과 서버 상태 조회 연결 | `ProgramTrustGate.tsx`, ADM 신뢰·복구 상태 API | 1 PASS | ADM 최초 인증 화면·API | ID 입력 후 서버 상태가 의도된 화면 전환에 반영되고 계정 정보가 무단 노출되지 않음 | 관련 상태 전환 단위 테스트와 개발 환경 API 확인 | PASS |
| 3 | 마스터 비밀번호 미등록 시 등록 버튼 표시 | `ProgramTrustGate.tsx`, 복구 상태 API | 2 PASS | ADM 화면 분기 | 유효한 복구 권한이 있을 때만 등록 버튼이 표시됨 | 유효·만료·부재 복구 권한 화면/API 테스트 | PASS |
| 4 | 마스터 비밀번호 등록 및 저장 | 복구 등록 API, `staff` 해시, 개발 DB 스키마 | 3 PASS, 개발 DB 스키마 확인 | 최고관리자 인증 정보·기존 세션 | 유효한 권한으로 해시가 저장되고 권한이 일회용으로 소비되며 세션이 무효화됨 | 개발 DB 통합 테스트, 재사용·만료·실패 경로 확인 | PASS |
| 5 | ID + 마스터 비밀번호 인증 | ADM 신뢰 등록 API, 비밀번호 검증 로직 | 4 PASS | ADM 최초 인증·시도 제한 | 올바른 자격만 통과하고 오류·잠금 정책이 유지됨 | 성공·실패·잠금 테스트와 개발 환경 API 확인 | PASS |
| 6 | 프로그램별 보안토큰 발급 및 검증 | 신뢰 토큰 API·쿠키·DB·호스트 접근 검사 | 5 PASS | POS·ADM·KDS 신뢰 상태 | 토큰이 프로그램별로 분리되고 서버 검증·폐기가 작동함 | 토큰 발급·교차 사용 거절·폐기 테스트 | PASS |
| 7 | 개인 PIN 등록 또는 기존 PIN 인증 | PIN API, 개인 PIN 정책, 로그인 화면 | 6 PASS | 직원 PIN·업무 화면 진입 | 새 PIN 등록 또는 기존 PIN 확인 후에만 세션이 생성됨 | PIN 등록·오입력·재시도·세션 생성 테스트 | PASS |
| 8 | 재접속 시 토큰 + PIN 로그인 | POS·ADM·KDS 로그인 API·화면 | 7 PASS | 재접속 인증 | 유효 토큰에 개인 PIN을 요구하고 무효 토큰은 최초 인증으로 돌아감 | 재접속·쿠키 만료·토큰 폐기 테스트 | PASS |
| 9 | 퇴사·프로그램 권한 변경 시 인증 무효화 | 직원 변경·퇴사 API, 토큰·세션 조회 | 8 PASS | 직원 권한·기존 세션 | 퇴사 또는 권한 해제 직후 해당 토큰과 세션이 거절됨 | 퇴사·비활성화·권한 해제 통합 테스트 | PASS |
| 10 | POS·ADM·KDS 통합 회귀 검증 | 관련 API·화면·테스트, 배포 준비 기록 | 1~9 PASS | 세 프로그램 인증 및 기존 기능 | 개발 환경에서 전체 흐름과 기존 정상 기능을 확인하고 결과·DB 변경·배포 필요 여부 기록 | 관련 테스트 모음, 빌드, 개발 환경 시나리오 점검 | PASS |

## 단계 기록

### 1단계 — PASS

- 분석: 기존 `check-owner-first-auth-test.cjs`는 `DB_NAME=TDK_POS_TEST`를 강제하고 `sondows` 계정의 권한·마스터 비밀번호 해시 존재 여부·PIN·로그인 잠금·복구 권한 수만 읽기 전용으로 조회한다.
- 검증: `node scripts/check-owner-first-auth-test.cjs` 실행 성공. `TDK_POS_TEST`에서 `sondows`는 단일 행(`staff_id=1`)이며 활성 최고관리자이고 ADM 권한과 개인 PIN, 관리자 2차 비밀번호가 있다. 마스터 비밀번호 해시는 `NULL`, 로그인 잠금은 없고 활성 복구 권한은 0건이다. 만료 1건·폐기 3건이다. 해시나 토큰 값은 출력하지 않았다.
- 체크포인트: `checkpoints/20261030-adm-auth-stage-01.md`에 읽기 전용 검증 결과와 다음 분기를 기록했다. 계정 및 운영 DB 데이터는 변경하지 않았다.

### 2단계 — PASS

- 분석: 기존 화면은 복구 링크의 서버 상태 조회 결과로 ID를 읽기 전용으로 채우고 즉시 등록 단계로 이동했다. 상태 API는 유효한 복구 권한과 일치하는 ID를 함께 검증한다.
- 수정: 복구 화면에서 ID 확인 단계를 추가하고, 제출한 ID와 복구 권한으로 상태 API를 다시 호출한다. 다른 ID·무효 권한은 다음 단계로 진행하지 않는다. API 요청·응답 처리는 `master-recovery-client.ts`에 둔다.
- 검증: 상태 전환과 클라이언트 API 계약 단위 테스트 5건 통과, 변경 파일 ESLint 및 TypeScript 통과. `TDK_POS_TEST` 스키마 확인 통과. `integration-master-recovery-test.cjs`는 유효·다른 ID·무효 권한의 API 응답을 확인하고 임시 계정 정리를 완료했다. 브라우저 클릭 경로는 10단계 통합 검증에서 다시 확인한다.
- 체크포인트: `checkpoints/20261030-adm-auth-stage-02.md`에 수정 파일과 검증 결과를 기록했다.

### 3단계 — PASS

- 분석: 서버는 `passwordConfigured`를 반환하지만 기존 화면 버튼은 그 값을 사용하지 않았다. 만료 검증은 DB 현지 시각의 `DATETIME`을 앱 서버 시각과 비교해 약 9시간 어긋났다.
- 수정: ID 확인 응답의 비밀번호 상태에 따라 등록/재설정 버튼과 안내를 구분했다. 복구 상태 조회와 등록 API의 만료 판정을 DB `NOW()`로 통일했다. 상태 쿠키 유효기간도 DB의 남은 시간으로 계산한다.
- 검증: 관련 단위 테스트 6건, TypeScript, 변경 파일 ESLint 통과. 개발 DB 통합 검사에서 무효·다른 ID·만료 권한이 거절되고 유효 권한이 처리됐다. 헤드리스 Chrome에서 ID 확인, 미등록 계정의 등록 버튼, 만료 링크 차단, 기존 비밀번호 계정의 재설정 버튼을 확인했다.
- 오류 분석: 개발 DB의 복구 상태 조회 제한 키가 55회로 누적돼 429가 화면 검사를 가렸다. 테스트가 해당 키를 검사 동안 분리하고 원래 값으로 복원하도록 수정했다. 검사 후 55회 복원 확인.
- 체크포인트: `checkpoints/20261030-adm-auth-stage-03.zip`에 이 단계의 코드·테스트·계획 스냅샷을 저장했다.

### 4단계 — PASS

- 분석: 복구 등록 API는 복구 권한을 잠근 트랜잭션 안에서 직원 해시·권한 사용 시각·토큰 폐기·세션 종료·감사 로그를 갱신한다. 개발 DB의 관련 스키마는 준비 상태다.
- 검증: `integration-master-recovery-test.cjs`에서 약한 비밀번호와 무효·만료·재사용 권한은 거절됐고, 거절 후 해시는 여전히 비어 있었다. 정상 등록 뒤 `scrypt$` 해시와 권한 사용 표식을 확인했다. 재설정 뒤 활성 토큰·세션이 각각 0건이었다. 임시 계정·권한 정리 완료.
- 체크포인트: `checkpoints/20261030-adm-auth-stage-04.zip`에 이 단계의 복구 API·통합 검사·계획 파일을 저장한다.

### 5단계 — PASS

- 분석: ADM 최초 인증은 `enrollProgramTrust`에서 ID·마스터 비밀번호를 검증한다. 실패 횟수는 계정별/검증된 IP별로 기록하며 15분 동안 5회부터 잠근다.
- 검증: `TDK_POS_TEST` 임시 계정의 잘못된 비밀번호 1~4회는 401, 5회와 잠금 중 올바른 비밀번호는 429였다. 검사에서 저장된 실패 횟수 5회와 15분 이내 시각을 확인한 뒤 임시 계정·잠금 데이터를 정리했다. 관련 단위 테스트 1건 및 변경 파일 ESLint 통과.
- 체크포인트: `checkpoints/20261031-adm-auth-stage-05.zip`에 이 단계의 인증 코드·통합 검사·계획 파일을 저장한다.

### 6단계 — PASS

- 분석: POS·ADM·KDS 토큰 쿠키 이름은 분리돼 있다. 서버는 토큰 해시·프로그램·직원 활성 상태·해당 권한·폐기 상태를 함께 확인하고, 폐기 시 연결된 세션을 종료한다.
- 검증: 호스트 접근·토큰·등록 단위 테스트 11건 통과. `integration-program-trust-test.cjs`에서 세 프로그램의 잘못된 비밀번호 401, 정상 발급 200, 타 프로그램 토큰 사용 거절, PIN 로그인 200, 토큰 폐기 뒤 페이지/API·세션 차단을 확인했다. 임시 직원 정리 완료.
- 체크포인트: `checkpoints/20261031-adm-auth-stage-06.zip`에 관련 코드·계획을 저장한다.

### 7단계 — PASS

- 분석: 신규 PIN은 프로그램 신뢰 토큰을 먼저 검증한 뒤 저장한다. 마스터 비밀번호 없이 최초 PIN을 등록할 수 있는 시간은 토큰 발급 후 10분이며, 기존 PIN 변경에는 재인증이 필요하다. 기존 코드의 10분 판정은 DB `DATETIME`과 앱 시각을 섞어 사용했다.
- 수정: 최초 PIN 허용 시간을 DB `NOW()` 기준으로 계산하고 트랜잭션 안에서도 다시 확인한다. 개발 DB 통합 검사에 11분 지난 토큰의 재인증 요구를 추가했다.
- 검증: PIN 정책·인증 상태 테스트 4건, TypeScript, 변경 파일 ESLint 통과. POS·ADM·KDS 각각 신규 PIN 등록 후 로그인 200과 잘못된 PIN 401을 확인했다. ADM에서 11분 지난 토큰의 무비밀번호 등록 403, 마스터 비밀번호 재인증 후 등록 200을 확인했다. 모든 임시 직원 정리 완료.
- 체크포인트: `checkpoints/20261031-adm-auth-stage-07.zip`에 PIN API·통합 검사·계획을 저장한다.

### 8단계 — PASS

- 분석: 로그아웃은 직원 세션만 종료하고 프로그램 신뢰 토큰은 유지한다. PIN 로그인 API는 해당 프로그램의 유효 토큰을 먼저 확인한다.
- 검증: 인증 상태 단위 테스트 3건과 검사 스크립트 ESLint 통과. 개발 DB 임시 직원으로 POS·ADM·KDS 각각 로그아웃 뒤 토큰이 유지됨을 확인했다. 토큰 없는 PIN 로그인은 403, 유효 토큰+PIN 재접속은 200, 토큰 폐기 후 기존 세션·PIN 재로그인은 차단됐다. 임시 계정 정리 완료.
- 체크포인트: `checkpoints/20261031-adm-auth-stage-08.zip`에 재접속 검사와 관련 코드를 저장한다.

### 9단계 — PASS

- 분석: 직원 수정 API는 해제한 프로그램의 토큰과 관련 세션을 폐기하고, 비활성화 시 모든 프로그램 접근을 끊는다. 퇴사 API는 모든 토큰·세션과 프로그램 권한을 종료한다. 두 API 모두 최고관리자 2차 인증을 요구한다.
- 검증: 직원 수정 단위 테스트 6건 및 새 통합 검사 ESLint 통과. `integration-staff-access-lifecycle-test.cjs`에서 2차 인증 없는 수정 428, 인증 후 KDS 권한 해제, 계정 비활성화, 퇴사 API의 토큰·세션·권한 차단을 개발 DB에서 확인했다. 임시 최고관리자와 직원 정리 완료.
- 체크포인트: `checkpoints/20261031-adm-auth-stage-09.zip`에 관련 API·검사·계획을 저장한다.

### 10단계 — PASS

- 분석: 단계 1~9 변경의 통합 회귀, 개발 DB 상태, 빌드와 배포 필요 여부를 확인했다.
- 검증: 인증 관련 단위 테스트 51건, 변경 파일 ESLint, 프로덕션 빌드 및 TypeScript 검사가 통과했다. 개발 DB에서 마스터 복구, POS·ADM·KDS 토큰/PIN/재접속, 최고관리자 2차 인증을 거친 직원 권한 생애주기, 임시 비밀번호 교체를 실제 API로 검사했다. 헤드리스 Chrome에서 ADM 복구 화면의 ID 확인·등록·만료·재설정 분기를 검사했다. 각 통합 검사는 임시 데이터를 정리했다.
- DB 상태: 이 작업에서 마이그레이션을 적용하지 않았다. `TDK_POS_TEST`의 인증 스키마는 준비 상태이며 검증 후 기존 직원 4명, 활성 신뢰 토큰 0건이다. 기존 `sondows`의 마스터 비밀번호 해시는 여전히 `NULL`이고 활성 복구 권한은 0건이다. 운영 DB `TDK_POS`는 변경하지 않았다.
- 배포: 코드 변경을 실제 운영에 반영하려면 NAS 배포와 운영 DB 마이그레이션이 필요하다. 두 작업은 사용자 승인 후 진행한다. 기존 최고관리자의 실제 최초 인증은 본인의 일회용 복구 링크 사용과 비밀번호 등록 후 별도로 확인해야 한다.
- 체크포인트: `checkpoints/20261031-adm-auth-stage-10.zip`에 최종 소스·마이그레이션·스크립트·계획 스냅샷을 저장한다.

## 실제 계정 수용 및 운영 전환

| 항목 | 현재 상태 | 다음 조건 |
| --- | --- | --- |
| 기존 `TDK_POS_TEST` 최고관리자 `sondows`의 직접 최초 인증 | BLOCKED | 본인이 15분 유효한 일회용 복구 링크에서 마스터 비밀번호를 등록하고 ADM 로그인·개인 PIN·2차 인증을 확인해야 한다. 현재 활성 링크는 없다. |
| 운영 DB `TDK_POS` 마이그레이션 및 NAS 배포 | BLOCKED | 사용자 승인과 운영 백업 확인이 필요하다. 승인 전에는 운영 데이터를 변경하지 않는다. |

전체 저장소의 기존 ESLint 오류는 이번 인증 변경과 별개로 남아 있다. 이번 변경 파일만 대상으로 한 ESLint는 통과했다. 빌드의 메뉴 이미지 저장 경로 경고 2건도 기존 파일에서 발생한다.

## ADM 로그인 ID 입력값 전달 재확인 — 2026-10-31

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `sondows` 입력의 화면 상태·입력 이벤트·기존 API 전달 확인 | ADM 로그인 화면 및 기존 복구 상태 조회 경로의 진단, 필요 시 ID 전달 부분만 | 개발 서버 및 기존 코드 확인 | ADM ID 입력과 상태 조회 | 실제 브라우저 입력·Enter·자동입력 유사 이벤트·기존 API 요청과 응답을 구분해 기록 | 개발 서버 브라우저 검사, 관련 단위 테스트, 서버 라우트 확인 | PASS |

이 단계에서는 마스터 비밀번호, PIN, 토큰, 권한, DB 구조, 인증 정책, POS·KDS 기능을 수정하지 않는다. 유효한 복구 권한이 없는 일반 로그인에서 계정 상태가 노출되지 않는 기존 정책은 유지한다.

### 1단계 — PASS: 진단 완료

- `src/components/ProgramTrustGate.tsx`의 ID 입력은 `value={loginId}`와 `onChange`의 `setLoginId(event.target.value)`로 연결된다. 앱 전용 `onBlur` 처리기는 없으며, 포커스 해제로 계정 조회를 시작하지 않는다.
- 개발 서버의 실제 `/tdkadm/login`에서 `sondows`를 입력한 뒤 화면 값과 React 렌더 속성 값이 모두 `sondows`임을 확인했다. 브라우저 이벤트는 `input` 3회, `change` 1회, `blur` 1회, Enter 1회였다. 포커스 해제와 Enter 후에도 ID가 유지됐다. 자동완성에 준하는 native setter + `input` 이벤트 후에도 두 값이 일치했다. 브라우저에 저장된 자격 증명의 실제 자동완성은 재현하지 않았다.
- 일반 ADM 로그인은 최초 로딩에 `GET /api/admin-center/trust`, `GET /api/admin-center/trust/initialize`를 호출한다. 이 요청은 ID를 포함하지 않는다. ID 입력·포커스 해제·비밀번호 없는 Enter 중 계정 상태 `POST` 호출은 없었다. 따라서 일반 화면에서 ID만 입력해도 계정 상태가 반영될 것이라는 기대는 현재 코드와 다르다.
- 기존 `POST /api/program-trust/master-recovery/status`는 유효한 일회용 복구 링크가 있을 때 `계정 상태 확인` 제출로만 호출된다. `master-recovery-client.test.mjs` 3건 통과: `sondows`를 요청 본문에 담는 동작, 다른 ID·권한 부재 응답 거절, 응답에 따른 분기를 확인했다. 서버 라우트는 본문 ID를 읽어 유효한 복구 권한과 계정을 함께 조회한다. 실제 `sondows` 계정의 유효한 복구 권한이 없어 이번 진단에서 해당 계정에 대한 서버 상태 응답은 검증하지 않았다.
- 수정: 진단 전용 `scripts/check-adm-id-input-test.cjs`와 이 계획 기록만 추가했다. 인증 코드와 DB 구조·데이터는 변경하지 않았다. 진단 스크립트 ESLint 통과. 운영 로그는 추가하지 않았다.
- 체크포인트: `checkpoints/20261031-adm-id-input-stage-01.zip`.

## ADM 마스터 비밀번호 최초 등록 및 화면 복귀 — 2026-10-31

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | NAS 승인 권한으로 해시 미등록 계정의 마스터 비밀번호만 저장하고 최초 인증 화면으로 복귀 | ADM `ProgramTrustGate`, 전용 최초 등록 API, 격리 DB 브라우저/API 테스트 | ADM ID 전달 진단 PASS, 기존 복구 권한/해시 저장 방식 확인 | ADM 승인된 최초 등록 분기만 | 승인 없는 등록 거절, 해시 NULL 계정에만 scrypt 해시 저장, PIN·권한·세션·토큰 보존, 브라우저에서 지정 화면 복귀 | `TDK_POS_TEST` 임시 계정으로 API·DB·Chrome 검증 | PASS |

작업 제한: 실제 `sondows` 자격 증명 변경 금지. 운영 DB `TDK_POS`와 DB 구조 변경 금지. 최초 등록 API는 기존 비밀번호 재설정 API와 분리하고 세션·토큰·PIN을 변경하지 않는다. 성공 후에는 로그인이나 다음 인증 단계를 실행하지 않는다.

### 1단계 — PASS

- 분석: 기존 NAS 발급 복구 링크는 직원 계정과 일회용 권한을 묶고, 상태 조회는 ID와 비밀번호 해시 등록 여부를 확인한다. 기존 비밀번호 재설정 API는 세션·신뢰 토큰까지 폐기하므로 최초 등록에서는 재사용하지 않는다. `/api/admin-center/trust/initialize`는 기존 직원이 없는 신규 설치 전용이라 `sondows`에 적용할 수 없다.
- 권한: 기존 `TDK_POS_TEST`의 `sondows`는 활성 최고관리자이고 별도 소유자 2차 인증 상태는 `ACTIVE`지만 `security_password_hash`는 `NULL`이다. 현재 활성 NAS 복구 권한은 0건이다. 따라서 실제 계정 비밀번호는 설정하지 않았으며, 테스트에서는 NAS 발급 권한을 모사한 일회용 grant를 임시 계정에만 발급했다.
- 구현: ID blur 또는 Enter에서 기존 상태 API를 호출한다. NAS 승인 grant와 ID가 일치하고 마스터 해시가 없으면 `마스터 비밀번호 등록` 창을 자동으로 연다. 별도 `register-initial` API가 서버에서도 grant 유효성·계정 연결·해시 NULL을 재검증한 뒤 `scrypt` 해시를 `staff.security_password_hash`에 최초 한 번만 저장하고 grant를 소비한다. 해시가 이미 있거나 승인 토큰이 없으면 등록을 거절한다. 입력창은 길이·영문·숫자·특수문자·일치 조건을 화면과 서버 양쪽에서 검사한다.
- 완료 화면: 성공 시 등록창을 닫고 복구 URL 상태를 지운 뒤 동일 ID, 빈 마스터 비밀번호 입력창, `인증` 버튼으로 돌아온다. 인증 API, PIN, 토큰, 세션은 호출·발급하지 않는다.
- 검증: `check-adm-initial-master-registration-test.cjs`가 `TDK_POS_TEST` 임시 최고관리자와 실제 Chrome에서 blur·Enter 양쪽의 창 전환, 약한/불일치 비밀번호 차단, 승인 없는 요청 거절, 상태 및 등록 API 응답 200, 해시 저장, grant 재사용 거절, ID 유지·빈 비밀번호·`인증` 표시를 확인했다. 임시 계정은 cleanup 완료했다. 테스트 행은 기존 PIN 센티널과 ACTIVE 소유자 2차 인증 정보를 그대로 보존했으며 토큰·세션은 생성되지 않았다. 인증 관련 단위 테스트 12건, 변경 파일 ESLint, TypeScript 검사 모두 통과했다.
- DB/배포: 테이블 구조 및 운영 DB `TDK_POS`를 변경하지 않았다. 테스트는 격리된 `TDK_POS_TEST` 임시 행만 사용 후 삭제했다. 실제 `sondows` 화면 등록은 NAS 관리자가 15분 일회용 권한을 발급한 뒤 별도 수행해야 한다. 이 단계에서 실제 로그인·PIN·토큰 단계로 진행하지 않았다.
- 체크포인트: `checkpoints/20261031-adm-master-password-initial-stage-01.zip`.

## 개발 서버 HMR 404 및 수정 반영 재확인 — 2026-10-31

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Next.js 개발 서버 HMR 연결·자동 반영을 확인하고 실행 상태를 재시작 | `server.cjs`, Next 설정·Proxy, HMR 진단 스크립트, 계획 기록 | 현재 3000 포트 서버 식별 | 개발 서버와 ADM 화면 갱신 | 개발 모드·올바른 프로젝트 경로·WebSocket 101·실제 소스 자동 반영·일반 새로고침·POS/ADM/KDS 경로 확인 | 재시작 전후 Chrome CDP와 임시 문구 변경 및 복구 | PASS |

### 1단계 — PASS

- 조사: `npm run dev`는 `node server.cjs`를 실행하며 `NODE_ENV`가 production이 아닐 때 `next({dev:true})`로 동작한다. 설치 버전은 Next.js 16.3.5, Turbopack이다. `getRequestHandler()`가 첫 요청의 Node HTTP 서버에서 Next 업그레이드 핸들러를 등록한다. `src/proxy.ts`와 인증 분기는 일반 HTTP 요청에 적용되며 정상 HMR WebSocket 업그레이드를 차단하지 않는다.
- 원인: 유효한 HMR은 `GET /_next/hmr?id=...` 형태의 WebSocket Upgrade이고 응답 `101`이 정상이다. Upgrade 헤더 없이 같은 경로를 일반 HTTP GET으로 요청하면 `404`가 반환된다. 재시작 직후 개발 로그에는 진단용 새 Chrome과 별개인 HMR `GET` 404가 한 차례 있었지만, 해당 요청 헤더와 출처는 수집하지 않아 오래된 세션 ID인지 비 Upgrade 요청인지 구분할 수 없었다. 진단용 새 Chrome의 WebSocket은 `101`을 받았고 HTTP 응답 404는 없었다. 서버 설정 오류는 재현되지 않았다. 기존 브라우저 탭에서 오류가 남으면 새로고침해 새 HMR 연결을 만든다.
- 경로: 포트 3000 소유 트리는 `npm run dev` → `node server.cjs`였고, Next가 시작 로그에서 현재 `D:\10_프로그래밍_소스\01_TDK_Web\tdk-pos`를 사용함을 확인했다. 실제 파일을 임시 변경해 브라우저 화면에서 읽어들인 것으로 소스·서버 경로가 일치함도 검증했다. 재시작 전후 임시 문구를 복구했다.
- 캐시/PWA: 프로젝트에 Service Worker 등록 코드나 서비스 워커 파일이 없다. 새 Chrome 프로필에서 localhost 서비스 워커 0개, Cache Storage 키 0개를 확인했다. 기존 사용자 프로필의 잔존 SW는 직접 접근하지 않았으며 이번 새 브라우저 검증에서는 PWA 캐시 영향이 없었다.
- 재시작 및 검증: 기존 터미널 세션에 연결할 수 없어 Ctrl-C와 비강제 종료를 시도했으나 종료되지 않았다. 포트 소유 트리를 재확인한 뒤 해당 개발 서버 프로세스만 종료하고 `npm run dev`를 다시 실행했다. 새 서버는 현재 실행 중이다. Chrome에서 `http://localhost:3000` 및 허용된 `http://192.168.0.54:3000` 모두 HMR 연결 101, 임시 텍스트의 자동 재컴파일·화면 반영, 원문 복구, 일반 새로고침 최신 화면 표시를 확인했다. Next 로그에 `Compiled in 2.5–2.8s`가 기록됐다. `/tdkadm/login`, `/tdkpos/login`, `/tdkkds`는 HTTP 200이었다.
- 변경/DB/운영: 런타임 서버·Proxy·인증 코드는 변경하지 않았다. `scripts/check-dev-hmr-test.cjs`는 임시 소스 문구를 자동 복구하는 개발 진단용으로 추가했다. `.next` 캐시를 삭제하지 않았고 DB·운영 빌드·Docker·NAS는 건드리지 않았다.
- 체크포인트: `checkpoints/20261031-dev-hmr-stage-01.zip`.

## ADM 최초 마스터 비밀번호 등록 흐름 단순화 — 2026-10-31

이 단계는 사용자의 최신 지시가 기존의 일회용 복구 링크 기반 최초 등록 정책을 대체한다. 별도 비밀번호 재설정용 복구 링크는 유지한다.

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 기존 최초 설치·복구 경로와 개발 DB 계정 상태 분석 | 초기화 API, 복구 API, ADM 화면, `TDK_POS_TEST` | 기존 코드와 개발 DB 읽기 | ADM 최초 등록 | `sondows` 해시 NULL 및 기존 권한·PIN 상태 확인 | 읽기 전용 `check-owner-first-auth-test.cjs` | PASS |
| 2 | NAS 로컬 초기 설정 경계 구현 | `kds-ingress.cjs`, `nas-owner-setup.ts`, 외부 Host 접근 정책 | 1 PASS | 최초 등록 API | 모드 미설정·LAN·외부 Host·위조 헤더 차단 | 입구 단위 테스트와 실제 HTTP Host 요청 | PASS |
| 3 | 최초 설치와 기존 최고관리자 NULL 해시 등록 | 초기화 API, 상태 API, 최초 등록 API | 2 PASS | 최고관리자 최초 비밀번호 | 1회 완료 표식, NULL 해시에만 해시 저장, 기존 PIN·권한 유지 | 최초 설치 API 단위 테스트, 개발 DB 격리 계정 통합 테스트 | PASS |
| 4 | ADM 등록창 및 인증 화면 복귀 | `ProgramTrustGate.tsx`, 인증 단계 흐름 | 3 PASS | ADM 로그인 화면 | ID blur·등록창·저장·ID 유지·빈 비밀번호·인증 버튼 | 실제 Chrome, `sondows` 읽기 전용 등록창과 격리 계정 저장 | PASS |
| 5 | 회귀 검증·운영 절차·복구 지점 | 관련 테스트, 문서, 체크포인트 | 4 PASS | 배포 전 검증 | 일반 모드 차단, 경로 200, 문서와 결과 기록 | TypeScript·ESLint·단위 테스트·일반 서버 API | PASS |

검증 결과: `TDK_POS_TEST`의 실제 `sondows`는 테스트 전후 모두 활성 최고관리자이며 `security_password_hash=NULL`, PIN·소유자 2차 인증 상태 유지. NAS 로컬 설정 모드에서 `sondows` ID의 blur와 Enter 후 실제 Chrome 등록창 표시를 확인했으며 비밀번호는 입력하거나 변경하지 않았다. 격리 계정에서는 실제 Chrome 등록·해시 저장·재등록 409·권한과 PIN 유지·ID 유지 및 빈 비밀번호와 `인증` 버튼 복귀를 확인하고 임시 행을 정리했다. 외부 Host는 403, 모드 종료 후 로컬 상태·등록 API도 403이다. 관련 단위 테스트 18건, TypeScript, ESLint 통과. 일반 모드에서 ADM·POS·KDS 경로는 모두 HTTP 200.

최초 설치 분기: 서버 1회 완료 표식과 중복 차단은 단위 테스트 통과. Chrome에서는 초기 설치 가능 API 응답을 모의해 ID·마스터 비밀번호·확인 입력 화면을 확인했다. 실제 빈 DB를 이용한 최초 최고관리자 생성은 기존 개발 데이터 보존 때문에 미검증이다. 운영 DB `TDK_POS`, DB 테이블 구조, 실제 `sondows` 비밀번호, PIN·토큰·세션, NAS 운영 배포는 변경하지 않았다.

복구 지점: `checkpoints/20261031-adm-nas-initial-setup.zip`에 이 단계에서 수정한 코드·테스트·문서·계획을 저장했다.

## ADM ID 입력 후 계정 상태 조회 루틴 점검 — 2026-10-31

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 입력·조회·접근 제어와 개발 DB 상태 확인 | `ProgramTrustGate.tsx`, 기존 상태 API, `TDK_POS_TEST` | 이전 최초 등록 단계 PASS | ADM 최초 인증 화면 | 일반 모드와 NAS 설정 모드의 응답 차이, `sondows`·토큰 상태 확인 | 코드 추적·읽기 전용 DB/API·Chrome 요청 기록 | PASS |
| 2 | 누락된 입력값 확정 연결만 수정 | ADM ID 입력 이벤트 | 1 PASS | ADM ID 자동완성·초기값 | DOM 값과 React 상태를 일치시키고 최신 ID만 반영 | Chrome 입력·자동완성·연속 변경 | PASS |
| 3 | 실제 브라우저 및 회귀 검증 | Chrome, TypeScript, ESLint | 2 PASS | ADM 화면 | 조회 요청·응답·화면 상태와 일반 모드 차단 확인 | Chrome CDP·관련 정적 검사 | PASS |

운영 DB `TDK_POS`, 개발 DB의 계정·비밀번호·PIN·보안토큰 데이터와 스키마, 마스터 비밀번호 등록·PIN·보안토큰 발급 로직은 변경하지 않는다. 기존 상태 조회 API의 시도 제한 기록은 요청에 따라 증가한다.

- 원인: 일반 입력의 `onChange`·`onBlur`·Enter와 기존 상태 조회 POST는 실행됐다. 일반 개발 서버는 `TDK_NAS_OWNER_SETUP` 미설정이어서 `POST /api/admin-center/trust/initial-master/status`에 403/`available:false`를 반환하므로 화면 변경이 없는 것은 기존 접근 제어의 결과다. 자동완성으로 DOM에만 ID가 채워지고 `onChange`가 없으면 기존 함수가 빈 React 상태를 읽어 조회를 생략하는 누락도 있었다.
- 수정: ADM ID 확정 시 실제 입력 DOM 값을 React 상태와 기존 조회 함수에 전달하고, 화면이 처음 나타날 때 미리 입력된 DOM 값을 확인한다. 동일 ID 중복 조회를 억제하며 ID 변경·로그인 진행 시 이전 응답을 무시한다. 새 API와 등록 권한은 추가하지 않았다.
- 개발 DB 읽기 전용 확인: `sondows`는 활성 OWNER·ADM 허용·해시 NULL이며 최초 설치 완료 표식은 이미 완료 상태다. `sondows`의 ADM 토큰 행은 0건, 새 Chrome 프로필의 신뢰 토큰 상태는 `trusted:false`였다. 테스트 전후 해시·PIN·2차 인증 상태는 유지됐다.
- 실제 Chrome 일반 모드: `sondows` 입력·blur·Enter, 다른 ID로 변경, DOM 값만 채운 초기 자동 입력에서 상태 조회 요청을 확인했다. 요청 ID·서버 403/`available:false`·React 표시값 일치·등록창 미표시를 확인했다.
- 실제 Chrome NAS 설정 모드: `sondows` 요청의 200/`available:true`와 등록창 표시를 확인했다. 이후 개발 DB의 기존 15분 상태 조회 제한 버킷이 31회가 되어 다음 요청은 429였다. 제한 행을 삭제하거나 초기화하지 않았다.
- Chrome 모의 API 응답: 200/`available:true`·200/`available:false`로 ID 재조회, 초기 자동 입력, 늦게 도착한 이전 ID 응답 무시를 확인했다. 이 세부 동작의 연속 실서버 재검증은 429 때문에 미실시다.
- TypeScript, 변경 파일 ESLint, 브라우저 테스트 통과. NAS 설정 모드를 종료한 일반 개발 서버에서 상태 API 403과 `trusted:false`를 재확인했다. 복구 지점: `checkpoints/20261031-adm-id-status-stage-01.zip`.

## ADM ID → 다음 로그인 화면 전환 — 2026-10-31

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 기존 ID·토큰·등록 상태 API 분석 | ProgramTrustGate, trust/status, initialize, initial-master/status | 이전 ID 조회 단계 PASS | ADM 최초 인증 화면 | 기존 API로 PIN·비밀번호·등록 화면을 분기할 수 있음 | 코드 추적·읽기 전용 개발 DB 조회 | IN_PROGRESS |
| 2 | ID 입력 → 다음 버튼 → 기존 상태 API 연결 | ProgramTrustGate, ADM PIN 화면의 선택 ID 전달 | 1 PASS | ADM 화면 전환 | 자동 조회 제거, 중복 제출 방지, 오류·뒤로가기·ID 유지 | Chrome 및 기존 화면 회귀 | PASS |
| 3 | 조건별 전환 검증 및 기록 | ADM UI 단위·브라우저 검증, PLANS | 2 PASS | ADM 화면 | 토큰·비밀번호·등록 권한 분기 확인 | Chrome, 테스트 계정/모의 응답, TypeScript·ESLint | PASS |

마스터 비밀번호 저장·검증 API, PIN 인증 API, 토큰 발급, DB 스키마·기존 계정·권한은 이 단계에서 수정하지 않는다. 운영 DB `TDK_POS`는 변경하지 않는다.
## ADM 로그인 ID → 다음 화면 전환 — 2026-10-31

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 기존 상태 조회 API와 화면 흐름 확인 | ProgramTrustGate, 기존 trust/initialize/initial-master/status API | ID 상태 조회 단계 PASS | ADM 최초 인증 화면 | 기존 API와 권한 검증 유지 | 코드 추적 및 일반 모드 응답 확인 | PASS |
| 2 | ID 입력 후 다음 버튼에서만 상태 조회하고 결과별 화면 이동 | ProgramTrustGate, AdminLoginForm, program-auth-flow | 1 PASS | ADM 최초 인증 및 PIN 진입 화면 | 자동 조회 제거, 중복 요청 차단, ID 유지 및 뒤로가기 | Chrome에서 입력·요청·분기 검증 | PASS |
| 3 | 오류 및 접근 권한 차단 검증과 기록 | Chrome 검사 스크립트, PLANS | 2 PASS | ADM 로그인 화면 | 일반 모드 등록 거부, 실패 안내, 기존 계정 데이터 보존 | 실제 일반 모드 요청과 모의 상태별 응답을 구분해 확인 | PASS |

- ID 입력 중 onChange/onBlur 및 자동완성 동기화는 상태 조회를 호출하지 않는다. 다음 버튼 제출만 기존 상태 API 세 곳(trust, initialize, initial-master/status)을 호출한다. 요청 중 버튼을 비활성화하고 동기화 잠금도 적용한다.
- 상태에 따라 유효 토큰은 기존 PIN 화면, 토큰이 없으면 기존 마스터 비밀번호 화면, 서버가 허가한 최초 등록은 기존 등록창, 초기 설치는 기존 최고관리자 등록 화면으로 이동한다. 실패 시 ID 화면에 오류를 표시한다. 화면 뒤로가기와 PIN 진입 시 ID를 유지한다.
- 일반 개발 모드 Chrome 요청에서 ID `sondows`가 상태 API에 전달되고 최초 등록 상태 API가 403을 반환하며 비밀번호 화면으로 이동하는 것을 확인했다. 따라서 ID만으로 비밀번호 등록창이 열리지 않는다.
- Chrome headless CDP 검증에서 입력만으로 API가 호출되지 않는 점, 응답 대기 중 중복 요청 차단, 토큰/PIN 분기, 초기 설치 분기, 서버 허가 등록창 분기, 서버 오류 안내, ID 유지 및 뒤로가기를 확인했다. 이 분기들의 응답은 격리된 브라우저 요청 모의 응답으로 검증했으며, 실제 NAS 초기 설정 권한으로 DB를 변경하지 않았다.
- TypeScript `tsc --noEmit`, 변경 파일 ESLint, 검증 스크립트 `node --check`, Chrome 검증을 통과했다. API, DB 스키마/데이터, 운영 DB `TDK_POS`는 변경하지 않았다.
- 복구 체크포인트: `checkpoints/20261031-adm-id-next-stage-01.zip`.

## ADM ID 다음 이후 화면 분기 오분기 수정 — 2026-10-31

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | TDK_POS_TEST 계정, bootstrap latch, 초기 설정 모드/API 상태 확인 | TDK_POS_TEST 및 기존 상태 API | ADM ID 다음 화면 기존 구현 | ADM 로그인 분기 | DB/API 응답을 읽기 전용으로 확인 | MySQL SELECT 및 실제 로컬 API 요청 | PASS |
| 2 | 등록 허용·비허용·비밀번호 등록 상태별 분기 수정 | 기존 initial-master/status API 응답, ProgramTrustGate | 1 PASS | ADM ID 다음 이후 화면 | 미등록·비허가 계정이 비밀번호 인증으로 오분기하지 않음 | TypeScript, ESLint, Chrome 분기 검사 | IN_PROGRESS |
| 3 | 실제 승인 초기 설정에서 sondows 등록 화면 검증 | 개발 서버, Chrome, TDK_POS_TEST | 2 구현 | ADM 최초 설정 화면 | 실제 API 200/available:true 및 등록창 표시 | Chrome에서 API와 화면을 함께 확인 | BLOCKED |

- 읽기 전용 DB 확인: TDK_POS_TEST에서 sondows 계정 존재, master hash NULL, OWNER, 활성, ADM 허용, 미퇴사, owner 레코드 존재. security_bootstrap_state.completed_at은 설정 완료 상태.
- 최초 설정 모드는 기본 서버에서 비활성. 일반 모드 실 API는 initial-master/status 403 available:false, initialize 200 available:false, trust 200 trusted:false를 반환했다. 기존 화면은 setup status 403을 정상 분기로 취급한 다음 무조건 LOGIN_PASSWORD로 이동한 것이 오분기 원인.
- 수정: 승인 모드 응답에서만 기존 상태 API가 계정 존재/비밀번호 설정 여부를 함께 반환하도록 하고, 유효 owner의 미등록 계정은 기존 등록창, 등록된 계정은 비밀번호 화면, 등록 권한이 없는 미등록 계정은 안내만 표시한다. setup status 403도 ID 화면의 권한 안내로 남긴다. 등록 API, PIN/토큰, DB 구조·데이터 변경 없음.
- 일반 모드 실제 Chrome에서는 403 뒤 등록 권한 안내가 표시되고 비밀번호 입력 화면으로 이동하지 않는 것까지 확인했다. 격리된 응답 모의로 다른 분기도 확인했으나 실제 모드 검증의 대체 PASS로 취급하지 않는다.
- 실제 승인 모드 검증을 위해 개발 서버를 로컬 설정 모드로 재시작했으나, 상태 API가 기존 DB 요청 제한으로 429를 반환했다. 카운터는 33회였으며 초기화·우회하지 않았다. 검증 후 서버를 일반 모드로 재시작했다. 실제 available:true 및 등록창 노출은 미검증이므로 전체 단계 완료/PASS로 표시하지 않는다.
- 검증: TypeScript, 변경 파일 ESLint, 검증 스크립트 구문 검사, 일반 모드 Chrome 검증 통과. 개발 DB/운영 DB 데이터는 변경하지 않았다.
- 복구 체크포인트: checkpoints/20261031-adm-id-next-branch-fix.zip.
- 정정: API 검증은 기존 admin_auth_attempts 상태 조회 제한 카운터를 정상 증가시켰다. 계정/비밀번호/최초 설정 데이터는 변경하지 않았으며 이 카운터를 초기화하거나 우회하지 않았다. 승인 모드 검증은 카운터 33회로 429가 반환되어 실제 등록 가능 응답까지 미완료다.

## ADM 최초 설정 차단 원인 및 Windows 개발 모드 — 2026-10-31

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | NAS/DB/계정/초기화/API/요청 제한의 호출 순서와 차단 원인 확인 | ProgramTrustGate, setup status, initialize, ingress, auth limit | 이전 ID 분기 수정 | ADM 최초 등록만 | 계정 상태와 권한 정책, limiter 동작 확정 | 코드 추적 및 TDK_POS_TEST 읽기 전용 조회 | PASS |
| 2 | 최초 설정 계정 상태 판정 공통화, UI 분기 명확화 | 기존 status 및 register-initial API, 공통 정책 모듈, ProgramTrustGate | 1 PASS | ADM 최초 설정/인증 분기 | 최초 설치·비밀번호 미등록·등록됨·복구를 구분하고 권한 gate 유지 | 단위 테스트 및 typecheck | PASS |
| 3 | Windows 관리자용 TDK_POS_TEST 전용 개발 초기 설정 실행 절차 | Windows PowerShell 실행 스크립트, ingress attestation, 설정 문서 | 2 PASS | Windows 개발 환경 로컬 localhost만 | 상승된 관리자 토큰, 개발 모드, TDK_POS_TEST를 모두 확인; production 거부 | 스크립트 구문/비관리자 거부/ingress 단위 테스트 | IN_PROGRESS |
| 4 | 실제 Windows Chrome에서 sondows 등록창 표시 | dev 서버, Chrome, TDK_POS_TEST | 2·3 PASS 및 상태 조회 제한 해제 | ADM 최초 등록 화면 | 실제 DB 응답 available:true와 등록창 표시 | Chrome CDP 실제 API 확인, 비밀번호는 입력/저장하지 않음 | BLOCKED |

- 차단 원인: 일반 Windows npm run dev에는 NAS setup 플래그가 없어 기존 status API가 403을 반환했다. 이전 로컬 설정 모드 확인은 동일 IP 15분 상태조회 제한기에 걸려 429가 났다. DB의 admin_auth_attempts 해당 카운터는 기존 33회였으며 초기화/우회하지 않았다.
- TDK_POS_TEST 읽기 전용 조회에서는 sondows가 활성 OWNER/ADM 허용, 마스터 hash NULL, bootstrap latch 완료로 확인됐다. 그러므로 빈 DB 최초 관리자 분기가 아니라 기존 owner 비밀번호 미등록 분기가 적용되어야 한다.
- 최초 설정 상태 판단을 공통 분류 함수로 모으고 initialize GET/POST, 초기 마스터 상태 API 및 기존 초기 등록 write API가 같은 계정 판정 함수를 사용하게 했다. 복구 토큰 흐름은 별도로 유지했다.
- Windows 개발 절차는 관리자 토큰, NODE_ENV=development, DB_NAME=TDK_POS_TEST 조건을 검사한다. Node ingress는 localhost loopback 요청에만 내부 attestation을 붙이며, 브라우저 위조 헤더, LAN 요청, 운영 모드는 거부한다. NAS setup 경로는 유지했다.
- 검증: 일반 모드 실제 Chrome은 실 API 403 뒤 안내를 표시하고 마스터 비밀번호 인증 화면으로 이동하지 않았다. 분류 단위 테스트 2개, ingress 테스트 9개, TypeScript, ESLint, PowerShell 구문 검사를 통과했다. 비관리자 실행은 명시적으로 거부됐다.
- 현재 실행 환경의 Windows 관리자 토큰은 비상승 상태다. 따라서 안전 스크립트로 설정 모드를 시작할 수 없어 실제 설정 모드 DB 응답과 Chrome 등록창은 검증하지 못했다. 모의 응답 분기는 통과했지만 PASS로 계산하지 않는다. 등록창 검증 단계는 BLOCKED로 남기고, 사용자 비밀번호 입력/DB 저장은 수행하지 않았다.
- 운영 DB TDK_POS 및 계정/해시/PIN/권한/최초 설정 데이터 변경 없음. 복구 체크포인트: checkpoints/20261031-adm-windows-owner-setup.zip.
- 일반 Chrome 검증 후 이 작업에서 실행한 일반 모드 개발 서버를 종료해 3000 포트를 비웠다. 관리자 PowerShell에서 전용 스크립트를 바로 시작할 수 있다. 제한 카운터는 마지막 읽기 전용 조회 시 33회/984초 경과로 15분 창을 지난 상태였다.

## Windows 개발 초기 설정의 불필요한 상태조회 제한 분리 — 2026-11-01

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 현재 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ADM 진입 시 자동 호출 여부와 429 발생 조건 확인 | ProgramTrustGate, initial-master/status, admin-auth-limit | Windows 초기 설정 모드 지원 | ADM 최초 ID 다음 | 자동 호출 및 limiter 위치 확인 | 코드 추적, 기존 30회/15분 제한 동작 확인 | PASS |
| 2 | Windows 관리자·개발 DB·localhost 설정 흐름에 한해 상태조회 limiter 충돌 제거 | owner setup mode, initial-master/status | 1 PASS | Windows 개발 초기 등록 상태 조회 | local dev는 반복 조회 차단 오류 없음, NAS/일반 경로 limiter 유지 | 정책 단위 테스트, TypeScript, ESLint | PASS |
| 3 | 제한 이력 보존 및 결과 문서화 | PLANS, checkpoint | 2 PASS | 문서 | limiter 카운터 삭제/초기화 없이 검증 | 관련 테스트 및 코드 검사 | PASS |

- 실제 원인: ADM 첫 화면 진입 자체는 계정 상태 API를 호출하지 않는다. ID 입력 후 다음을 누를 때 initial-master/status가 호출된다. 상태 API는 승인된 설정 모드 요청마다 15분 IP 제한 카운터를 증가시키며 30회를 넘으면 429를 반환한다. 이전 조회 시 34회로 제한 창 안에 있었다.
- 수정: 인증 정책이나 카운터 기록을 지우지 않고, Windows 개발 전용 모드(NODE_ENV=development, DB_NAME=TDK_POS_TEST, TDK_WINDOWS_DEV_OWNER_SETUP=1)에서는 기존 loopback setup attestation 검사 이후에만 이 읽기 전용 상태조회 rate limit을 생략한다. NAS setup 및 다른 경로의 30회/15분 제한은 유지한다. 비밀번호 등록 write 실패 제한과 OWNER/hash NULL 검사도 그대로 유지.
- 기존 제한 카운터는 변경/삭제하지 않았다. production, 운영 DB, NAS 모드에서는 제한 로직이 유지됨을 정책 테스트로 확인.
- 검증: TypeScript, ESLint, 상태 정책 테스트 3건, ingress 보안 테스트 9건 통과. Chrome 실화면 검증은 이번 변경 범위에서 수행하지 않았다.
- 복구 체크포인트: checkpoints/20261101-adm-windows-status-limit.zip.

## 3000번 ADM 최초 설정 요청 제한 오류의 런타임 원인 — 2026-11-01

- 재현: 현재 `http://localhost:3000/api/admin-center/trust/initial-master/status`에 `sondows`를 1회 요청했고 HTTP 429, `{"available":false}`를 확인했다. DB·계정·마스터 비밀번호 저장 API는 호출하거나 변경하지 않았다.
- 코드 원인: 429는 기존 15분 요청 제한을 Windows 개발 설정 모드가 해제하지 못할 때 반환된다. 소스에는 개발 DB `TDK_POS_TEST`와 `TDK_WINDOWS_DEV_OWNER_SETUP=1`이 모두 설정된 경우 제한을 면제하는 로직이 있으며, 해당 정책 단위 테스트는 통과한다.
- 실행 원인: 현 요청이 429인 점으로 미루어 현재 응답 프로세스의 유효 런타임 환경은 Windows 설정 모드가 아니다. 실제로 포트 3000에 기존 PID 533464가 LISTENING 중이며, 프로세스 정보 조회는 권한 거부되어 어느 터미널에서 어떤 환경으로 시작됐는지는 확인할 수 없었다. 기존 프로세스가 일반 `npm run dev`로 시작된 상태에서 설정 스크립트 실행이 포트 충돌로 실패했거나, 브라우저가 그 서버에 계속 접속하는 상황이 root cause다. 제한 카운터나 초기 설정 latch를 지우지 않았다.
- 수정: `scripts/start-windows-owner-setup.ps1`는 기존 개발 서버를 종료하지 않고 첫 빈 포트(기본 3000, 현재처럼 점유 중이면 3001)를 선택해 전용 설정 서버를 띄운다. 시작 URL과 설정 모드/DB 이름을 출력한다. `server.cjs`도 개발 서버 시작 시 DB 이름과 Windows owner setup 활성 여부만 출력한다(비밀값 출력 없음).
- 검증: PowerShell 파서 PASS, `node --check server.cjs` PASS, TypeScript `tsc --noEmit` PASS, 변경 관련 ESLint PASS, `node --experimental-strip-types --test src/lib/initial-admin-setup.test.mjs` 3/3 PASS. 직접 브라우저 설정 모드의 등록 화면 검증은 현재 서버 프로세스를 재시작하지 못해 BLOCKED이며 PASS 처리하지 않는다.
- DB 변경 없음. 운영 DB `TDK_POS` 변경 없음. 테스트용 비밀번호 저장 없음.
- 다음 재개 시: 관리자 PowerShell에서 기존 3000 개발 서버를 실행한 터미널에서 Ctrl+C로 종료하고, `Set-Location 'D:\10_프로그래밍_소스\01_TDK_Web\tdk-pos'; .\scripts\start-windows-owner-setup.ps1` 실행. 서버 시작 시 `DB_NAME=TDK_POS_TEST, Windows owner setup=enabled`를 확인하고 브라우저에서 `http://localhost:3000/tdkadm` 새로고침 후 `sondows` 조회 결과를 확인한다.
## 마스터 비밀번호 → 프로그램 토큰 → PIN 연결 — 2026-11-01

| 단계 | 목표 | 수정 대상 | 선행 조건 | 완료 기준 | 검증 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 마스터 비밀번호 인증 결과가 다음 단계로 연결 | ProgramTrustGate, trust enrollment API | 기존 인증/계정 확인 | 일반 설정 모드에서 setup 전용 403은 등록 거절로 유지하면서 일반 비밀번호 인증은 진행; 실패 시 토큰 없음 | `TDK_POS_TEST` 임시 직원 실 API: 잘못된 비밀번호 401, 정답 200 | PASS |
| 2 | 프로그램 토큰 해시 저장 및 안전 쿠키 발급/사용 | program trust API, DB, 쿠키 | 1 PASS | 무작위 토큰, DB SHA-256, Secure·HttpOnly·SameSite 쿠키, 프로그램 간 분리, 기존 유효 토큰 재사용 | 실제 ADM API/DB 통합 검사 통과. 브라우저의 실제 쿠키 저장은 Chrome 검증 차단 | IN_PROGRESS |
| 3 | PIN 상태에 따른 등록/입력 분기 | ProgramTrustGate, trust status | 2 PASS | DB PIN 상태가 화면 분기와 일치 | 임시 계정 API는 pinSetupRequired=true; sondows는 기존 PIN 등록 | PASS |
| 4 | 최초 PIN 등록과 세션 생성 | `/api/program-trust/pin`, 세션 | 3 PASS | 6자리 정책, 해시 저장, 세션 쿠키/DB 행 | 임시 계정 실제 ADM API 통과, Chrome 화면은 미검증 | PASS |
| 5 | 기존 PIN 인증 및 로그인 | ADM 로그인 API/UI | 4 PASS | PIN 성공 시 세션, 실패 거부 | 임시 계정 실제 API 성공/실패 통과, Chrome 화면은 미검증 | IN_PROGRESS |
| 6 | 재접속 토큰 + PIN 흐름 | trust status, PIN login | 5 PASS | 유효 쿠키 후 PIN 재로그인, 폐기/퇴사 토큰 거부 | 임시 계정 API 재접속 통과, Chrome 쿠키 자동 저장은 미검증 | TODO |

- sondows 읽기 전용 상태: TDK_POS_TEST, staff_id=1, 활성 OWNER, ADM 권한, 퇴사 아님, 마스터 해시 등록(scrypt), 개인 PIN 등록, 활성 ADM 토큰 1건, 최근 마스터 로그인 잠금 없음. 그러므로 이 계정에서 `ID + PIN` 화면은 유효 토큰과 기존 PIN에 따른 정상 분기이며 PIN 등록 화면으로 바뀌면 안 된다.
- 차단 원인: ADM ID 다음 분기는 등록 권한 전용 `initial-master/status` API가 일반 로그인에서 반환하는 403을 전체 인증 실패로 처리했다. 이 때문에 마스터 해시가 있는 일반 계정도 비밀번호 인증 단계에 도달하지 못했다.
- 수정: setup status 403은 계정/해시 정보를 노출하지 않고 `LOGIN_PASSWORD`로 진행한다. API가 일반 계정의 마스터 해시를 검증하며, 미등록/없는/비활성/권한 없는 계정은 기존 generic 실패 응답으로 거부된다. 최초 등록 허용 판정은 기존처럼 setup status의 승인 응답에만 의존한다.
- 실제 통합 검사(개발 DB에 임시 직원 1명 생성 후 정리): 잘못된 마스터 비밀번호 401 및 쿠키 없음, 올바른 비밀번호 ADM 토큰 발급 200, DB SHA-256 해시 일치 및 원문 미저장, HttpOnly+Secure+SameSite=Strict, 상태 API trusted=true, 최초 PIN 등록과 세션, 잘못된 PIN 401, PIN 로그인·재접속·페이지 200을 확인했다. `cleanup=complete`; 기존 sondows 행/비밀번호/PIN/토큰은 변경하지 않았다.
- 단위 테스트 8건, TypeScript, ESLint, Node 구문 검사는 통과했다. Chrome CDP 검증은 새 격리 프로필에서도 `Page.enable timeout`으로 실패해 실제 UI 화면 및 브라우저 쿠키 자동 저장을 확인하지 못했다. 이를 PASS로 기록하지 않는다. 이 이유로 2단계에 머물며 3~6단계는 진행하지 않는다.
- 운영 DB TDK_POS, 스키마, 기존 직원 데이터 변경 없음. 테스트 계정은 개발 DB에서 제거 완료. 테스트 비밀번호/PIN은 로그에 출력하지 않았다.
## ADM 마스터 비밀번호 인증 단일화 — 2026-11-01

| 단계 | 목표 | 대상 | 선행 | 완료 기준 | 테스트 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 인증 API·검증 함수·저장 컬럼·호출처와 TDK_POS_TEST 상태 조사 | trust routes, owner-security routes, schema, read-only query | 없음 | 두 경로의 저장/검증 차이 및 이전 영향 범위 기록 | 코드 추적, 비밀값 없는 SELECT | PASS |
| 2 | OWNER 보안 확인이 직원 마스터 해시를 사용하게 전환 | admin-auth.ts, owner-password route | 1 PASS | 소유자 멤버십 검사는 별도로 유지, old owner hash fallback 없음 | helper/route tests, TypeScript | PASS |
| 3 | 보안 메뉴 비밀번호 변경을 직원 마스터 해시 변경으로 연결 | owner-password route/UI | 2 PASS | 새 비밀번호가 ADM 인증과 보안 재인증에 동일, 세션·토큰 수명 정책 보존 | 개발 DB 임시 OWNER 통합 테스트 | PASS |
| 4 | OWNER 관리 흐름에서 레거시 비밀번호 인증 의존 제거 | owners route/UI, owner helper | 2 PASS | 권한 관리는 membership 기반, 레거시 hash는 인증·가용성 판정에 미사용 | owner management/role tests | PASS |
| 5 | 문구 변경 및 POS·ADM·KDS 회귀 | OwnerSecurityPrompt, auth routes/tests | 2~4 PASS | 보안 확인에 ‘마스터 비밀번호’, 일반 직원 차단, 기존 PIN·토큰 보존 | 실제 API/DB + Chrome 가능한 항목, full relevant suite | IN_PROGRESS |

- 조사 결과: ADM trust enrollment(`src/lib/program-trust-routes.ts`)는 `staff.security_password_hash`를 `verifySecurityPassword`로 확인한다. ADM 보안 메뉴(`/api/admin-center/security/owner-password`, `getOwnerSecurityState`)는 `admin_security_owners.password_hash`와 `credential_state`를 별도로 확인한다. 직원 관리·토큰 관리·OWNER 관리 API는 `requireOwnerSecurityAccess`로 이 별도 상태에 의존한다.
- 저장: `staff.security_password_hash`는 직원별 마스터 비밀번호이며, `admin_security_owners.password_hash`는 기존 OWNER 전용 확인값이다. `admin_security_settings.owner_security_password_hash` 컬럼도 있으나 현재 런타임 코드에서는 참조되지 않는다. 두 scrypt 해시가 모두 설정된 것은 읽기 전용으로 확인했지만 해시 비교만으로 원문 비밀번호 동일/상이 여부를 단정하지 않는다.
- TDK_POS_TEST sondows: staff_id=1, 활성 OWNER/ADM 허용, 직원 마스터 해시 설정, OWNER 전용 해시 설정/ACTIVE, 개인 PIN 및 활성 ADM 토큰 존재. 두 해시 원문은 읽거나 기록하지 않았다.
- 정책: OWNER 여부는 `admin_security_owners` 멤버십으로 계속 판정하고, 인증만 `staff.security_password_hash`로 통합한다. 레거시 OWNER 해시는 삭제·덮어쓰기하지 않고 인증 fallback에도 쓰지 않는다. DB 스키마와 운영 DB `TDK_POS`는 변경하지 않는다.

- Implementation: ADM master login and OWNER security reauthentication both verify `staff.security_password_hash`. OWNER access is still gated separately by `admin_security_owners` membership. Legacy OWNER hash and status are no longer used for verification or availability; stored values and schema are preserved. Changing the master password updates only the staff master hash and clears OWNER reauthentication freshness. Existing PIN, program trust tokens, and login sessions remain active. Temporary master-password issuance can target another OWNER but blocks self-targeting.
- Actual TDK_POS_TEST API integration: temporary OWNER master login 200, master password change 200 and changed password ADM login 200, legacy OWNER password 401, master reauthentication 200, owner management 200, trust-token management 200, regular ADM employee owner-management access 403. Existing OWNER PIN hash and active token count stayed unchanged across password change; legacy OWNER hash stayed unchanged. Regular employee PIN setup/login/re-entry also passed. Temporary rows, tokens, sessions, and logs were cleaned (`cleanup=complete`).
- Read-only sondows state after test: TDK_POS_TEST; active OWNER with ADM access; master password and PIN configured; one active ADM token. No sondows credential or token data was changed.
- Verification: `tsc --noEmit` PASS, changed-file ESLint PASS, owner-password route/helper tests 7/7 PASS, program-trust tests 5/5 PASS, live development-server + TDK_POS_TEST API integration PASS. Direct Chrome UI inspection was unavailable, so visual rendering remains unverified and stage 5 stays IN_PROGRESS. No production DB, schema, or sondows data was changed.

- Screenshot follow-up: corrected the OWNER security prompt Korean strings that had been written as question marks. The source now contains UTF-8 Korean for the title, description, input label, and button. TypeScript and ESLint pass; post-fix visual browser confirmation is still pending.

## 공통 마스터 비밀번호 검증 함수 통합 — 2026-11-01

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 기존 비밀번호 검증 함수·API·해시 저장 위치 조사 | program-trust-routes, owner-password, temporary-password, PIN setup | 없음 | POS/ADM/KDS 최초 인증 및 ADM 보안 재인증 | 검증 코드가 분산된 위치와 레거시 저장소 사용 여부 기록 | 코드 추적, 스키마 확인, 읽기 전용 조회 | PASS |
| 2 | 직원 활성/퇴사 상태와 scrypt 해시를 확인하는 서버 공통 함수 구현 | src/lib/master-password.ts, 단위 테스트 | 1 PASS | 서버 내부 인증만 | 정상·오류·미등록·비활성·퇴사 계정 결과 검증 | 격리된 단위 테스트, TypeScript, ESLint | PASS |
| 3 | 프로그램 최초 인증 및 기존 마스터 검증 호출을 공통 함수로 교체 | program-trust-routes, temporary-password, PIN setup | 2 PASS | POS/ADM/KDS/HOS 공용 라우트 | 공통 함수 사용, 토큰/쿠키/PIN 로직 유지 | route tests, TDK_POS_TEST 임시 계정 통합 | PASS |
| 4 | ADM 보안 메뉴 재인증과 비밀번호 변경 검증을 공통 함수로 교체 | owner-password, 관리자 보안 route guards | 2 PASS | 직원·신뢰토큰·OWNER 관리 및 기타 OWNER 전용 API | 세션 직원 ID만 인증 대상으로 사용, OWNER 권한 분리 유지 | API 테스트, TDK_POS_TEST 임시 OWNER | PASS |
| 5 | 구형 OWNER 비밀번호 경로가 인증에 사용되지 않는지 확인 | auth helpers, owners route, 전체 참조 | 3~4 PASS | 레거시 데이터 보존 | 구형 해시 fallback 없음, 런타임 참조 제거 | 저장소 검색, 테스트 | PASS |
| 6 | 통합 회귀 검증 및 단계 결과 기록 | 관련 API와 기존 통합 테스트 | 3~5 PASS | POS/ADM/KDS | 공통 인증, 권한 차단, 기존 토큰/PIN 동작 확인 | TypeScript, ESLint, 단위·실제 API 통합 테스트 | PASS |

- 조사 결과: 현재 scrypt 비교 원시 함수는 `src/lib/auth.ts`의 `verifySecurityPassword(password, storedHash)`이며, 프로그램 trust enrollment와 PIN 재인증, 임시 비밀번호 변경, OWNER 재인증/변경에서 각각 직원 해시를 직접 가져와 호출한다.
- 저장 위치: 활성 직원 마스터 해시는 `staff.security_password_hash`이다. 구형 OWNER 비밀번호는 `admin_security_owners.password_hash`에 남아있을 수 있으며, 구형 전역 컬럼 `admin_security_settings.owner_security_password_hash`는 런타임 검증 경로에서 참조되지 않는다. 현재 인증 경로는 모두 직원별 해시를 향하도록 이미 전환되어 있으며 저장된 레거시 값은 보존한다.
- Stage 2 PASS: added server-only `verifyMasterPassword(employeeId, password)`; validates employee ID, active status, non-terminated status, configured staff master hash, and delegates scrypt comparison to the existing verifier. Unit tests 3/3, TypeScript, and ESLint passed.
- Stage 3 PASS: shared verifier applied to POS/ADM/KDS trust enrollment, temporary master-password replacement, and PIN reauthentication. Targeted tests, TypeScript, ESLint, and live TDK_POS_TEST integration passed; token, cookie, and PIN flows were retained.
- Stage 4 PASS: OWNER security reauthentication and password change use the shared verifier with the session actor staff ID; OWNER membership and route authorization remain separate. Route tests and live TDK_POS_TEST integration passed.
- Stage 5 PASS: runtime search shows `admin_security_owners.password_hash` and `credential_state` are not used for authentication; the only `owner_security_password_hash` reference is the preserved schema column. Removed the unused OWNER-only password hash/policy helpers. The generic scrypt comparator remains used only by `verifyMasterPassword`.
- Stage 6 PASS: 20 targeted unit/route tests passed. TDK_POS_TEST live program-trust integration passed for POS, ADM, and KDS: wrong master password 401, enrollment 200, wrong PIN 401, login/reconnect/page 200; temporary test data cleanup completed. Live OWNER integration passed: master login/change/re-auth, legacy OWNER password rejected, owner/trust-token management accepted, regular employee blocked, PIN/token hashes retained; cleanup completed. TypeScript and ESLint passed.
- No production DB or schema changes. No sondows credentials, PIN, trust tokens, or permissions were modified.



## sondows authentication reset and first-login retest preparation ? 2026-11-01

- Database guard and read-only preflight confirmed the connected database was exactly TDK_POS_TEST and the unique target was staff_id 1 / staff_code 001, role OWNER, active, ADM enabled, with one OWNER membership. No production database was accessed.
- Reset only staff.security_password_hash and staff.employee_pin_hash to NULL; set security_password_change_required to 0. No password or PIN was generated. Employee identity, OWNER membership/role, ADM permission, activation state, and work data were retained.
- Revoked the target employee's one active ADM program trust token and logged out the two active ADMIN sessions. No other program token/session counts changed.
- Post-transaction read-only verification: account present; OWNER membership 1; ADM enabled; master password and PIN unset; active ADM tokens 0; active ADMIN sessions 0. The first-owner bootstrap latch remains completed and unchanged.
- Recovery checkpoint: checkpoints/20261101-sondows-auth-reset-20261031230923182.dpapi. It contains only pre-reset credential hashes/flag and the affected ADM-token/session state, encrypted with Windows DPAPI for the current Windows user. Restore/decrypt only under that same Windows user if recovery is needed; never commit or share this file.
- Registration readiness: the existing-account route classifies an active OWNER with ADM access and a NULL master hash as MASTER_PASSWORD_REQUIRED. The one-way first-owner latch is not reset. Status/registration still require server setup attestation. The dedicated script enables it only for NODE_ENV=development, DB_NAME=TDK_POS_TEST, and TDK_WINDOWS_DEV_OWNER_SETUP=1.
- To start the isolated local setup server, open an elevated PowerShell in the project directory and run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-windows-owner-setup.ps1. The script selects an available localhost port and prints the URL. Use that printed URL on this PC only, open /tdkadm, enter sondows, then choose Next. Enter the new master password and PIN directly in the browser. Stop the setup server with Ctrl+C after the test; the script's process-local setup mode ends with it.
- Verification limit: DB state and server route preconditions were checked. The setup server was not started and Chrome registration, token cookie, PIN enrollment, and re-entry were not browser-verified.
- No schema or authentication API/UI code changed.


## ADM ID validation and access-control inspection ? 2026-11-01

| Check | Result | Evidence / limits |
| --- | --- | --- |
| ID existence | PASS | Read-only TDK_POS_TEST status API returned MASTER_PASSWORD_SET for sondows and ACCOUNT_NOT_FOUND for a valid-format typo ID. |
| Active account | PASS (code/unit) | Classifier rejects inactive accounts as ACCOUNT_UNAVAILABLE; a DB inactive fixture exists but has no admin_login_id, so it cannot be exercised through the login-ID endpoint. |
| Terminated account blocked | UNVERIFIED | Status/classifier and token lookup filter terminated accounts; TDK_POS_TEST contains no terminated employee fixture. |
| ADM permission | PASS (code) | Status classifier and trust enrollment/token lookup enforce admin_enabled; one DB no-ADM fixture exists but has no admin_login_id, so no live ID API case was possible. |
| Same generic error | FAIL | In authorized setup mode the missing ID falls through to a generic account-status message, while ACCOUNT_UNAVAILABLE has a distinct message. The requested exact generic copy is not used. |
| Invalid ID cannot enter authentication | FAIL in ordinary mode | ProgramTrustGate intentionally treats initial-master/status HTTP 403 as normal-login fallback and changes to LOGIN_PASSWORD without establishing whether the ID exists. In authorized setup mode, ACCOUNT_NOT_FOUND does not advance. |
| Direct API bypass | PASS (guards verified; no valid-credential exploit attempted) | Initial master registration requires server-attested setup and an eligible OWNER with an unset hash. Trust enrollment filters active/non-terminated/ADM-enabled staff and verifies the master password. PIN setup requires a current program trust token and rechecks permission. Safe live malformed requests returned ID-only registration 400, malformed trust enrollment 401, and malformed PIN setup 400. |
| Existing token invalidation | PASS (DB + unit logic) | sondows has zero active ADM tokens and zero active ADMIN sessions in TDK_POS_TEST. The isolated trust unit test confirms a revoked token is not accepted. A browser holding the old raw cookie was not available for live replay. |

- Frontend analysis: ID is sent from the submit handler to three requests (ADM trust GET, bootstrap GET, and initial-master status POST). It preserves the typed ID on status errors and renders an aria-live alert below the form, but no code focuses the ID input after an error.
- Actual server/API: localhost /tdkadm/login returned HTTP 200. Read-only trust GET returned trusted=false. Initial-master status returned MASTER_PASSWORD_SET for sondows and ACCOUNT_NOT_FOUND for the typo. Safe malformed direct API probes were rejected. No valid password/PIN/token was sent, and no token or account data was changed.
- Browser: scripts/check-adm-id-next-test.cjs was attempted with headless Chrome, but Chrome DevTools Protocol timed out at Page.enable before navigation; browser behavior is therefore UNVERIFIED. This is not recorded as a PASS.
- Isolated tests: initial-admin-setup, program-trust, and program-trust-enrollment tests passed 8/8. No application code, DB schema, employee credential, token, or permission was modified. The task remains limited to inspection; the ordinary-mode fallback and generic-message mismatches are findings only.


## ADM master-password screen prompt and autofocus ? 2026-11-01

| Step | Goal | Target | Prerequisite | Impact | Completion criteria | Test | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Remove ADM password-stage back link, change stage-specific helper copy, and focus password input after phase render | src/components/ProgramTrustGate.tsx | Existing ADM ID-to-password flow | ADM login UI only | ADM password phase has no back link, correct helper text, and password input receives focus after transition | TypeScript, changed-file ESLint, actual Chrome focus check | IN_PROGRESS |

- Implemented the ADM-only link removal and password-stage copy; ID-stage guidance, other program screens, and bootstrap back navigation are preserved. Added a password input ref and an effect keyed only to program/phase, so ordinary rerenders do not refocus or clear the password value.
- TypeScript PASS; ESLint for the changed component PASS.
- Chrome verification remains unverified: the installed Chrome 156 opened the debug endpoint but did not return Page.enable responses; temporary headless and UI-mode extension automation also returned no result. The app route itself returned HTTP 200. No password was entered or submitted. Do not mark this stage PASS until focus is observed in Chrome.
- No authentication API, credential verification, token, PIN, or database code was changed.


## ADM initial PIN setup helper text ? 2026-11-01

| Step | Goal | Target | Prerequisite | Impact | Completion criteria | Test | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Show the requested helper under the ADM initial PIN registration button | src/components/ProgramTrustGate.tsx | SETUP_PIN with ADM and no PIN reset | ADM initial PIN setup only | Centered text-xs slate-500 copy under button, natural existing form/card spacing | TypeScript, ESLint, actual Chrome screen | IN_PROGRESS |

- Added ??? ??? ?? 6?? PIN?? ??????.? only when program=ADM, phase=SETUP_PIN, and pinReset=false. Existing form space-y-4 and card padding provide button-to-copy and bottom spacing; input/button styles are unchanged. POS/KDS and PIN reset screens do not render this copy.
- TypeScript PASS; ESLint for ProgramTrustGate.tsx PASS. No auth/API/DB changes.
- Actual Chrome screen rendering was not verified. Chrome DevTools automation in this environment times out on Page.enable; do not mark this UI step PASS until the text is observed in Chrome.


## ADM staff master-password and PIN reset ? 2026-11-01

| Step | Goal | Target | Prerequisite | Impact | Completion criteria | Test | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Inspect existing staff reset, master registration, program token, session, and PIN flows; create source checkpoint | Existing routes/components/schema | None | Read-only | Reuse existing fields/tables and document dependencies | Source inspection, schema review | PASS |
| 2 | Replace temporary-password endpoint with OWNER-confirmed atomic credential reset | Staff modal, owner action, security-password route | 1 PASS | Target employee only | Master/PIN unset, reset authorization set, all-program tokens and sessions revoked, audit row recorded in one transaction | Live endpoint, authenticated non-owner denial, DB effect inspection | PASS |
| 3 | Allow one-time master-password re-registration only for explicitly reset employees | Initial-master status/register route, shared program login flow | 2 PASS | Reset-flagged account only | Status prompts registration; successful registration consumes flag; NULL hash alone never grants permission | Live status/register API, ordinary account denied | PASS |
| 4 | Verify program-specific token and shared PIN behavior after re-registration | Trust enrollment, PIN flow | 3 PASS | POS/ADM/KDS, HOS token records if present | Current-program token issued; shared PIN enrolled; stale tokens/sessions rejected | Live API and DB inspection | PASS |
| 5 | Run isolated end-to-end validation in TDK_POS_TEST and clean temporary fixtures | Test script, all relevant APIs/DB rows | 2-4 PASS | Temporary test OWNER and employee only | Reset, state, registration, master auth, token, PIN, session, permissions and other-employee isolation all verified; cleanup complete | Guarded live integration against TDK_POS_TEST only | PASS |
| 6 | Record outcomes and retain a recoverable checkpoint | PLANS.md, .codex-backups | 1-5 results | Documentation | Results accurately distinguish PASS/unverified; test fixtures removed | Read-only post-check | PASS |

- Stage 1 findings: existing staff.security_password_change_required can serve as the one-time reset authorization when paired with a NULL master hash; staff.employee_pin_hash is the current shared PIN; program_trust_tokens records POS/ADM/KDS/HOS tokens; staff_sessions stores active POS/ADMIN/KDS sessions. No schema change is currently needed.
- Pre-change source checkpoint: .codex-backups/20261101-staff-credential-reset-before.zip.
- Production DB TDK_POS is out of scope. Live testing is guarded to TDK_POS_TEST and temporary fixtures only.
- Stage 2 PASS: replaced the former temporary-password action with an OWNER-reauthenticated confirmation and one DB transaction. The target's unified and legacy POS/ADM/KDS PIN hashes are cleared, the master hash is NULL, the one-time reset flag is set, all POS/ADM/KDS/HOS trust rows are revoked, all active staff sessions are logged out, and the actor/target/time are audited. Account identity, role, activation, and available permission fields are not updated. No password is returned.
- Stage 3 PASS: reset state is accepted only for active, non-terminated, non-shared target staff with `security_password_change_required=1` and a NULL master hash. This explicit state takes priority over initial-owner setup mode. An ordinary account with a NULL hash was rejected (HTTP 409); successful re-registration saved the hash and cleared the flag. POS/KDS trust enrollment returns a registration prompt only for the same explicit reset state.
- Stage 4 PASS: the live TDK_POS_TEST flow issued a new ADM token after the newly registered master password, detected the shared PIN as unset, registered one PIN, and created a session. Revoked POS/ADM/KDS cookies were rejected; HOS trust-row revocation was verified directly in DB.
- Stage 5 PASS: isolated live integration passed OWNER reset, authenticated non-OWNER denial (403), all four token revocations, zero active target sessions, unchanged active status/role/POS/KDS/ADM permissions, one reset audit row, reset status, unauthorized registration denial, new master authentication, and PIN registration. The temporary OWNER/employee, trust tokens, sessions, and audit rows were cleaned. TDK_POS was not accessed.
- Verification: TypeScript `tsc --noEmit` PASS; targeted ESLint PASS; related unit tests 8/8 PASS; guarded TDK_POS_TEST live integration PASS. Chrome visual inspection was not run. The test DB lacks `staff.hos_enabled` even though the current source schema declares it; no schema change was made, so HOS permission preservation could not be directly queried. HOS token-row revocation was verified.
- Post-implementation checkpoint retained at `.codex-backups/20261101-staff-credential-reset-after.zip`.


## KDS employee master-password, trust-token, and PIN login integration — 2026-11-01

| Step | Goal | Target | Prerequisite | Impact | Completion criteria | Test | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Inspect KDS login, common auth, API/page gates, real-time transport, and test DB schema | KDS auth/UI/API/server files | None | Read-only | Existing flows and gaps recorded without changing ADM/POS | Source and schema inspection | PASS |
| 2 | Make KDS login ID-first and connect ID → KDS trust check → master/password or PIN phase | KDS-only branch of ProgramTrustGate, KitchenLogin | 1 PASS | KDS login UI only | ID persists across phases, KDS token checked for that ID, KDS-specific focus and guidance | TypeScript, ESLint, auth-flow tests | PASS |
| 3 | Verify server master auth, KDS token, shared PIN enrollment/login, and KDS permission enforcement | Existing shared trust/PIN/KDS session routes | 2 PASS | KDS auth only | Active/non-terminated/KDS-enabled checks; KDS-only token; PIN shared across programs | Unit and live TDK_POS_TEST API integration | PASS |
| 4 | Audit protected page, every KDS data/action API, session invalidation, and real-time transport | KDS page, APIs, server ingress | 3 PASS | KDS access boundary | Stale/revoked token and session denied; all data/action routes guarded; real-time transport documented | Route tests and direct API probes | PASS |
| 5 | End-to-end KDS login, reconnect, permission denial, reset invalidation, and regression tests | Isolated fixture and KDS surfaces | 3-4 PASS | Temporary test employee only | Valid and invalid flows pass; order data untouched; cleanup complete | TDK_POS_TEST live API and browser/tablet | IN_PROGRESS |
| 6 | Record results and checkpoint | PLANS.md, `.codex-backups` | 1-5 results | Documentation | Accurate PASS/unverified reporting and recoverable checkpoint | Read-only post-check | PASS |

- Stage 1 findings: `ProgramTrustGate` already uses shared `enrollProgramTrust`, `verifyMasterPassword`, program-specific cookies, and shared PIN setup. KDS PIN login creates a `staff_sessions` KDS session linked to the KDS trust token. `getCurrentKdsStaff` checks active account, KDS permission, active session, PIN presence, and current non-revoked KDS trust; protected KDS order read and mutation routes call it. No WebSocket or EventSource transport exists; `KitchenClient` polls `/api/kitchen` and uses authenticated POST actions. ADM/POS code and KDS work/order logic remain out of scope.
- Existing UI gap: KDS opens in `LOGIN_PASSWORD`/trust auto-check and shows ID + master password together when untrusted; the nested PIN form independently asks for ID and does not consume the ID already checked by `ProgramTrustGate`. KDS also lacks explicit stage focus transitions.
- KDS-only edits to the shared gate are permitted only behind `program === "KDS"`; preserve ADM and POS behavior.
- Production DB `TDK_POS` is out of scope. Live fixtures must assert `DB_NAME === TDK_POS_TEST` and be removed in `finally`.
- Stage 2 PASS: KDS now starts with ID and Next, queries the KDS trust status for that ID, preserves the ID, then shows the password or PIN phase from the server result. Password/PIN inputs receive stage-specific focus; the nested KDS PIN screen consumes the gate's ID context. ADM/POS flows are unchanged. TypeScript and targeted ESLint pass.
- Stage 3 PASS: the shared trust enrollment verifies the common master password and issues only a KDS-scoped trust token. KDS ID status checks active, non-terminated, non-shared, KDS-enabled staff; token enrollment and PIN login retain server-side permission/session checks. Live TDK_POS_TEST standard-PIN and first-PIN flows passed, including wrong password/PIN, login, reconnect, and page response. POS/ADM/HOS trust cookies did not cross-authenticate as KDS.
- Stage 4 PASS: KDS page session validation and `/api/kitchen`, task mutation, table start, and table completion handlers call `getCurrentKdsStaff`; live calls to the read and three action APIs returned 401 after trust revocation. KDS reset-token invalidation uses the existing all-program reset route. No WebSocket or EventSource endpoint exists; KitchenClient polls `/api/kitchen` and sends authenticated action requests, so no live socket remains to revoke.
- Stage 5 partial: live fixture tests covered KDS ID status, inactive/terminated/KDS-OFF denial, token issuance, shared PIN registration, PIN login, reconnect, logout, and revoked-token data/action API denial. All fixture data was removed and no order data was changed. Chrome verification is UNVERIFIED: the Chrome DevTools Page.enable request timed out, and headless DOM capture exited with code 2147483651 before rendering. No browser PASS is claimed.
- Related unit tests: 13/13 PASS; TypeScript `tsc --noEmit`, targeted ESLint, integration script syntax, and `git diff --check` PASS. The live TDK_POS_TEST API integration passed with cleanup; production DB was not accessed and KDS order/cooking data was not modified.
- Browser limitation: Chrome DevTools `Page.enable` timed out; headless DOM capture exited with code 2147483651 before rendering. Chrome/tablet visual and focus behavior remain UNVERIFIED, so stage 5 remains IN_PROGRESS.
- Post-change source checkpoint: `.codex-backups/20261101-kds-auth-after.zip` (KDS gate/UI/routes/tests and PLANS.md). Stage 6 documentation and checkpoint PASS.


## KDS login replacement using the verified ADM flow — 2026-11-01

| Step | Goal | Target | Prerequisite | Impact | Completion criteria | Test | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Compare the active ADM login implementation with KDS UI, status lookup, token, password and PIN paths | ProgramTrustGate, AdminLoginForm, KitchenLogin, KDS trust route | None | Read-only | Differences and reusable shared code recorded | Source and route inspection | PASS |
| 2 | Align KDS ID/status/password phases and guidance with ADM while preserving KDS eligibility and token scope | KDS-only paths in ProgramTrustGate and program-trust-routes | 1 PASS | KDS login only | ID-only first step, server KDS checks, common password/token path, no password-stage back link | TypeScript, ESLint, auth-flow unit tests | PASS |
| 3 | Remove the legacy separate KDS PIN presentation and align it with ADM's shared PIN stage | KitchenLogin and shared auth context | 2 PASS | KDS login only | Shared employee PIN, KDS login endpoint/session and existing design constraints preserved | TypeScript, ESLint, PIN/API tests | PASS |
| 4 | Validate KDS login, token isolation, authorization and protected KDS work APIs against TDK_POS_TEST | Existing KDS APIs and isolated fixtures | 2-3 PASS | Temporary test fixtures only | Positive and negative paths pass; order data untouched; fixtures cleaned | Guarded live API integration | IN_PROGRESS |
| 5 | Verify the rendered login and navigation in Chrome, record results and retain a checkpoint | KDS browser route, PLANS.md, .codex-backups | 2-4 results | Browser and documentation | Chrome confirms ID-only first step, stage transitions, focus, PIN and KDS entry; checkpoint retained | Actual Chrome; post-check | TODO |

- ADM implementation baseline: both programs use `ProgramTrustGate`; ADM ID submit uses ADM-only bootstrap and setup-status APIs, while KDS correctly uses `/api/kitchen/auth/trust?loginId=...` so account eligibility is checked against `kds_enabled` and the token remains KDS-scoped. Both programs submit master-password verification through the same `enrollProgramTrust` and `verifyMasterPassword` server path. PIN registration uses the shared `/api/program-trust/pin` path and employee PIN hash; PIN login must use each program's own session route.
- KDS-specific differences found: the shared gate starts KDS at `LOGIN_ID`, but its password phase still renders the selected ID beside the password and includes the `뒤로가기 · ID 변경` link; the request explicitly requires removing that KDS password-stage link. KDS has its own PIN-login form because its endpoint creates a KDS session; it already consumes the shared gate's ID and employee PIN. ADM's bootstrap/status APIs are ADM-scoped and must not be called for KDS.
- Existing KDS main page and order/action APIs remain guarded by `getCurrentKdsStaff`; polling remains the live update method. No WebSocket/EventSource route was found. No KDS order/cooking logic, DB schema, ADM login code, POS login code, or production DB is in scope.
- Pre-change checkpoint for this replacement: `.codex-backups/20261101-kds-login-replacement-before.zip`.
- Stage 2 PASS: KDS begins with an ID-only form, validates active/non-terminated/KDS-enabled status through the KDS trust endpoint, and follows server status to KDS PIN, reset-password registration, approved first-owner registration, or the common master-password login path. The permitted reset flag is exposed as a boolean only after KDS eligibility checks. Master verification/token issuance still uses the shared `enrollProgramTrust`/`verifyMasterPassword` path and KDS token cookie. The password screen retains the ID but no longer renders the old back link; KDS copy matches ADM. Password input autofocus remains phase-driven. No ADM/POS logic or token policy changed.
- Stage 2 verification: TypeScript, targeted ESLint and related unit/API tests PASS (13/13). The unit suite now checks the explicit-reset status behavior. Checkpoint for this completed step: `.codex-backups/20261101-kds-login-replacement-stage2.zip`.
- Stage 3 PASS: KDS PIN login now uses ADM's login-card CSS and two-field layout while retaining the KDS-specific PIN session API, current KDS auth context ID, error handling, and autofocus. PIN setup remains on the shared ProgramTrustGate path. No ADM source or KDS work-screen code changed.
- Rate-limit root cause found while diagnosing the live 429: the existing Drizzle upsert's generated assignment order updates `window_started_at` before evaluating the `attempt_count` reset expression. On an expired bucket, that expression then sees the new timestamp and increments the old count instead of resetting it, so the IP can remain locked past the 15-minute window. `reserveKdsIpAttempt` now uses a transaction, inserts a no-op row if absent, locks and reads the row, evaluates expiry once, and writes either 1 or the incremented count. The 30-per-15-minute policy is unchanged. Unit coverage asserts both expired-window reset and active-window denial.
- Stage 4 live retry: guarded script again confirmed `DB_NAME=TDK_POS_TEST` and cleaned its temporary employee, but got HTTP 429 before authorization assertions. A read-only DB query showed the limiter bucket at 33 attempts and 256 seconds into its window. This indicates the server on `localhost:3000` is still executing the older compiled limiter; the updated source's expiry logic is not yet verified against the live API. No limiter row was edited or deleted, and no production DB was accessed.
- Related TypeScript, targeted ESLint, and unit/API checks now PASS (15/15); `node --check scripts/check-kds-chrome-login.cjs` and `git diff --check` PASS. Stage 4 remains IN_PROGRESS until live API integration can run against the updated server after the pre-existing limiter window expires.
- A disposable Chrome end-to-end check is available at `scripts/check-kds-chrome-login.cjs`. It creates a random reset-authorized employee only in `TDK_POS_TEST`, drives ID → registration → master authentication → PIN setup → KDS page in Chrome, checks focus and HttpOnly token behavior, then cleans the fixture and temporary browser profile. Actual browser verification remains unverified: prior attempts connected to Chrome DevTools but timed out waiting for `Page.enable`; no browser PASS is claimed. Stage 5 remains TODO.

## KDS ID 조회 429 근본 원인 및 limiter 식별 개선 — 2026-11-01

| 단계 | 작업 | 완료 기준 | 결과 |
| --- | --- | --- | --- |
| 1 | ID submit → status API → limiter 경로와 ADM 비교 | fetch 수, 응답 및 카운터 소유 범위 확정 | PASS (코드 추적 및 TDK_POS_TEST read-only 확인) |
| 2 | 개발 환경 IP 식별 및 상태조회/PIN limiter 분리 | 위조 헤더 미신뢰, 제한 정책 유지, 목적별 독립 카운터 | PASS (단위 테스트) |
| 3 | 타입·lint·API 관련 테스트 | 전체 통과 | PASS |
| 4 | 실제 서버 및 Chrome 재검증, ADM 회귀 확인 | 새 코드를 제공하는 서버에서 ID 조회와 인증 흐름 정상 | IN_PROGRESS |

- 최초 원인: KDS 상태 API `GET /api/kitchen/auth/trust?loginId=...`가 `reserveKdsIpAttempt`를 사용한다. 개발 ingress의 localhost 경로는 `x-tdk-local-dev`만 설정하고 `x-tdk-verified-client-ip`는 설정하지 않아, `getKdsRateLimitIp()`가 null을 반환했다. limiter는 null 모두를 SHA-256(`unverified-client-ip`) 하나로 합쳐 개발 요청을 전역 IP 버킷 하나에 누적했다. `TDK_POS_TEST` read-only 조회에서 해당 버킷은 34회였고, 15분 창 내라 단 한 번의 새 클릭도 429를 받는 상태였다. 이 KDS 버킷은 PIN 로그인도 공유했다. 이전 만료 처리 순서 오류가 있으면 창이 만료된 뒤에도 누적 횟수가 초기화되지 않을 수 있었다.
- 프런트엔드 추적: ID 화면 폼에는 `onSubmit`만 있고 다음 버튼은 submit 버튼이다. KDS ID 상태 조회 `useEffect`, 자동 재시도, 클릭 핸들러 중복은 없다. 제출 lock이 중복 제출을 막는다. 요청 과다 오류는 실제 HTTP 429에서만 표시된다. 429 응답이면 먼저 실패 분기에서 반환하므로 **KDS 상태 API 요청은 1회**, ADM 초기설정 상태 조회 후속 요청은 0회다. 200 응답일 때만 후속 `POST /api/admin-center/trust/initial-master/status`를 호출한다. 이벤트 계측을 통한 실제 Chrome 네트워크 횟수는 아직 확인하지 않았다.
- ADM 비교: ADM의 ID 다음은 `/api/admin-center/trust` 상태 조회이며 KDS IP limiter를 사용하지 않는다. 그 외 setup/status 요청은 별도 정책이다. Strict Mode는 이벤트 핸들러를 중복 실행하지 않고, ID 화면 자동 조회도 없다.
- 수정: `kds-ingress.cjs`에서 비운영 환경의 limiter 주소는 위조 가능한 forwarded header 대신 TCP socket peer에서 정규화해 설정한다. `reserveKdsIpAttempt` 카운터 키에 목적(`id-status` 또는 `pin-login`)을 포함해 ID 상태조회와 PIN 인증의 횟수를 분리했다. 두 경로 모두 기존 30회/15분 정책을 유지한다. 만료 창은 기존 트랜잭션/row-lock 방식으로 1부터 다시 시작한다. ADM/POS, 운영 ingress, 계정/PIN/토큰 데이터는 변경하지 않았다.
- 정적 검증: TypeScript PASS, 변경 관련 ESLint PASS, 관련 ingress/auth/API 테스트 26/26 PASS, `node --check kds-ingress.cjs` PASS.
- 실제 서버 확인은 BLOCKED: `localhost:3000`의 sondows GET은 HTTP 200을 반환했지만 새 IP+scope limiter 버킷 기록이 없었다. 격리 통합 테스트에서는 임시 테스트 직원의 KDS status API가 현 소스상 기대하는 403 대신 200을 반환했고 임시 직원 정리는 완료됐다. 이는 3000번 서버가 현재 작업 트리의 코드를 실행하지 않는다는 증거다. limiter 데이터는 수정하지 않았고 운영 DB는 접근하지 않았다. 따라서 수정 후 실제 API/Chrome 및 ADM 회귀는 PASS로 표시하지 않는다.
- 복구 체크포인트: `.codex-backups/20261101-kds-id-status-limit-root-cause.zip`.

## KDS PIN 로그인 429 및 인증 경로 점검 — 2026-11-01

| 단계 | 목표 | 결과 |
| --- | --- | --- |
| 1 | PIN 화면부터 토큰 확인, PIN 제한, 검증, 세션 생성까지 호출 경로 조사 | PASS (코드 및 read-only DB 확인) |
| 2 | 중복 제출 방지, limiter 원인 식별 테스트, 오류 코드 구분 | PASS (TypeScript, ESLint, 테스트) |
| 3 | 개발 서버·Chrome에서 실제 PIN 로그인과 ADM 회귀 확인 | IN_PROGRESS (실행 중 서버가 현재 코드와 불일치) |

- 현재 단일 PIN 경로: `KitchenLogin` 폼 `onSubmit` → `POST /api/kitchen/auth/login` (ID와 PIN JSON; same-origin fetch는 브라우저 쿠키를 자동 첨부) → `getCurrentProgramTrust("KDS", { loginId })`로 직원·KDS 프로그램·서명 토큰 쿠키 확인 → `reserveKdsIpAttempt("pin-login")` → 활성 직원 조회 → 직원 단위 제한 → 공통 `verifyEmployeePin` → `KDS_LOGIN_SUCCESS` 감사 이벤트와 KDS 타입 `staff_sessions` 생성 → `tdk_kds_session` HttpOnly 쿠키 반환. 토큰이 없거나 직원 ID와 다르면 IP limiter 전에 `403 TRUST_REQUIRED`로 처리한다. 별도 구형 KDS PIN API 호출은 없으며 다른 프로그램용 `verifyStaffPin` / `verifyAdminStaffPin`은 KDS route에서 사용하지 않는다.
- 원인 판정: `KitchenLogin.errorText`가 HTTP 429를 PIN 오류와 구분하지 않고 같은 “로그인 시도가 많습니다” 문구로 바꾼다. TDK_POS_TEST read-only 조사에서 `kds_auth_ip_attempts`에는 단일 레거시 `SHA-256("unverified-client-ip")` 버킷이 있었고 35회, 15분 창 안이었다. `kds_login_attempts` 행은 0개였으며 sondows 직원 단위 실패 카운터도 없었다. 서버 코드는 KDS IP 제한을 PIN 검증보다 먼저 실행하므로 해당 네트워크 버킷이 차단하면 PIN 불일치 여부와 관계없이 429가 난다. 앞선 ID 조회 제한 수정이 현재 서버에서 실행되지 않아 이전 공용 미확인 IP 버킷이 남아 ID 조회와 PIN 로그인을 함께 막는 것이 직접 원인으로 확인됐다.
- 중복 인증 여부: 실제 KDS PIN route는 하나뿐이다. PIN 화면에는 submit handler 하나만 있고 로그인 fetch도 한 곳이다. 중복 `onClick`/`onSubmit`은 없다. `useState(busy)` 방어 외에 in-flight ref lock이 없어서 빠른 연속 제출 경합 가능성은 제거하고 `submitLock` ref를 추가했다. 잘못된 PIN 제한은 직원별 5회/15분이고 IP 제한은 별도 30회/15분이다. KDS 마스터 비밀번호 등록은 `trust-enroll-kds` 인증 제한을 사용하며 PIN 카운터와 분리되어 있다. ADM PIN은 공통 PIN 검증 함수를 쓰지만 `adm-login` 계정/IP 실패 제한을 사용하고 KDS IP 제한을 공유하지 않는다.
- 수정: PIN 로그인 제출 ref lock 추가. 오류 UI에서 `KDS_IP_RATE_LIMIT`와 `KDS_EMPLOYEE_RATE_LIMIT`를 구분해 표시. 앞 절의 수정사항처럼 KDS ID 조회와 PIN 제한 key는 각각 `id-status`와 `pin-login`으로 분리하고, 개발 ingress는 TCP peer IP를 limiter 식별자로 넣는다. 기존 30/15 IP, 5/15 직원 실패 정책은 유지. 인증 함수·DB 스키마·계정/PIN/토큰 데이터를 수정하지 않았다.
- 검증: TypeScript PASS, 관련 ESLint PASS, 관련 auth/ingress/API 테스트 27/27 PASS. route unit test는 신뢰 KDS 토큰이 있을 때 IP limiter가 `429 KDS_IP_RATE_LIMIT`을 반환하고 PIN/직원 조회로 진행하지 않음을 확인한다.
- 실제 API/브라우저 미검증: 앞선 `localhost:3000` 통합 검사는 임시 직원을 정리했지만 현 소스가 기대한 미등록 ID 403 대신 200을 반환했다. 같은 런타임에서 sondows trust status GET은 200이었으나 새 scope 카운터 기록이 없었다. 따라서 해당 서버가 현재 작업 트리 수정사항을 반영하지 않는다. PIN POST 실제 HTTP 응답/쿠키와 Chrome Network 패널, ADM 회귀는 확인하지 않았다. 35회 레거시 카운터와 직원 단위 0건은 TDK_POS_TEST에서 읽기 전용 확인했으며 카운터를 지우거나 운영 DB를 사용하지 않았다.
- 복구 체크포인트: `.codex-backups/20261101-kds-pin-login-root-cause.zip`.

## KDS 네트워크 로그인 요청 제한 근본 원인 수정 — 2026-11-01

| 단계 | 목표 | 수정 대상 | 완료 기준 | 검증 | 상태 |
| --- | --- | --- | --- | --- | --- |
| 1 | KDS 요청 제한, IP 식별, 인증 API 호출 경로 조사 | KDS ingress, 인증 API, limiter | 429 경로와 로그인 요청별 카운터 확인 | 소스 추적 및 개발 API 관찰 | PASS |
| 2 | IP 미확인 공용 버킷 제거 및 네트워크/단계별 제한 분리 | KDS limiter, ID/비밀번호/PIN API | IP 없으면 503, 네트워크와 단계별 30회/15분 독립 카운터 | 단위/API 테스트 | PASS |
| 3 | 오류를 제한 종류별로 표시하고 재시도 폭주 방지 | KDS 로그인 UI, 상태 확인 | 네트워크/단계 제한과 IP 식별 오류 구분 | TypeScript, ESLint, 코드 검토 | PASS |
| 4 | 최신 개발 서버와 Chrome에서 전체 로그인 재검증 | Windows dev runtime, TDK_POS_TEST, Chrome | 최신 ingress에서 IP 식별 및 로그인 확인 | 실제 브라우저/API | BLOCKED |
| 5 | 결과와 복구 체크포인트 기록 | PLANS.md, .codex-backups | 검증/미검증을 구분하고 복원 지점 보존 | 문서와 checkpoint | PASS |

- 근본 원인: 이전 TDK_POS_TEST 조회에서 unverified-client-ip 공용 버킷 하나에 36회가 누적되어 있었다. IP 확인 실패 때 모든 개발 클라이언트와 인증 단계가 그 한 키로 합쳐져 30회 제한을 넘긴 뒤 정상 ID 조회도 429가 됐다. 이전 만료 처리에는 만료된 값을 1로 재설정하지 못하는 SQL assignment 순서 문제도 있어 row-lock 트랜잭션으로 고쳤다.
- IP 식별: 개발은 Node TCP peer를 사용하고 브라우저 전달 헤더는 폐기한다. 운영 reverse proxy는 Caddy 공유 비밀이 검증된 요청의 x-tdk-proxy-client-ip만 사용한다. 미확인 IP는 공용 fallback 없이 503 KDS_RATE_LIMIT_IP_UNAVAILABLE로 처리한다. X-Forwarded-For는 신뢰하지 않는다.
- 제한: 인증 요청 한 건은 network bucket과 해당 단계 bucket 각각 한 번 집계한다. 양쪽 모두 30회/15분이며 id-status, initial-master-status, master-auth, initial-master-register, pin-setup, pin-login이 분리된다. 비밀번호 실패 및 직원별 PIN 실패 제한도 별도 유지한다. 31번째 요청은 네트워크 또는 해당 단계에서 429다.
- 코드상 일반 최초 로그인은 ID 상태 GET 1회, 일반 초기 설정 확인 POST 1회, 마스터 인증 POST 1회, PIN 등록 또는 PIN 로그인 POST 1회다. 초기 비밀번호 등록/재등록 경로에서는 상태 POST 대신 비밀번호 등록 POST가 실행되어 총 5회가 된다. 각 HTTP 요청은 network에 1회와 해당 단계에 1회만 집계된다. 이 요청 수는 코드 추적 결과이며 Chrome에서 실측하지 않았다.
- 검증: limiter/PIN API/enrollment 12/12 PASS; ingress/IP spoofing 10/10 PASS; npx.cmd tsc --noEmit PASS; 대상 파일 ESLint PASS.
- 실행 서버: localhost:3000의 KDS ID 상태 API가 HTTP 503 KDS_RATE_LIMIT_IP_UNAVAILABLE을 반환했다. 현재 ingress 소스의 개발 IP 설정과 달라 실행 서버가 오래된 코드를 사용 중이라는 직접 증거다. PID 104608 Node 종료는 Access denied로 실패했다. 최신 서버에서 DB 카운터 증가, 31번째 요청, 다중 기기/직원 및 Chrome 로그인은 미검증이며 단계 4는 BLOCKED다. 개발 서버 재시작 후 실제 검증이 필요하다.
- TDK_POS 운영 DB는 접근하거나 변경하지 않았다. 복구 체크포인트: .codex-backups/20261101-kds-network-rate-limit-after.zip.

### 실행 서버 재검증 — 2026-11-01

- 사용자가 최신 개발 서버를 재시작한 뒤 KDS trust status API를 실제 호출했다: `GET /api/kitchen/auth/trust?loginId=sondows` → HTTP 200, `success=true`, `trusted=false`, `passwordRegistrationRequired=false`. IP 식별 503은 재현되지 않았다. `trusted=false`는 이 HTTP 요청에 브라우저 KDS 쿠키가 없다는 뜻이다.
- TDK_POS_TEST를 지정한 읽기 전용 조회에서 sondows는 1행, OWNER, 활성, 미퇴사, KDS 사용 허용, 마스터 비밀번호 설정, PIN 설정 상태였다. 미폐기 KDS token row는 1개였다. 비밀번호/PIN 해시 원문은 출력하지 않았다. 계정의 비밀번호를 알 수 없어 sondows 마스터 인증이나 해당 계정으로 새 토큰 발급은 시도하지 않았다.
- 실제 Chrome headless를 통해 TDK_POS_TEST 임시 직원으로 ID부터 마스터 등록, 공통 마스터 인증, KDS token 발급, PIN 등록, KDS 화면 진입을 검증했다. 별도 재접속 검증에서는 KDS 로그아웃 후 새로고침 시 KDS token cookie가 유효한 상태로 PIN 화면이 나타났고, PIN 제출 후 KDS 메인 화면에 도달했다. 이는 토큰 값을 브라우저 스크립트에 노출하지 않은 functional cookie 전달 검증이다. 테스트 직원, 세션, 감사 및 토큰 행은 스크립트에서 정리 완료됐다.
- Chrome UI에서 KDS PIN 로그인 후 실제 메인 화면 진입 PASS. PIN 경로는 KDS 전용 API를 사용했고 성공 응답 이후 보호된 KDS page가 렌더링됐다. 별도의 주문 변경은 하지 않았다.
- ADM 회귀: `/tdkadm/login` HTTP 200, `/api/admin-center/trust?loginId=sondows` HTTP 200. 자격증명을 제출하지 않았으므로 ADM 비밀번호 인증 자체는 실행하지 않았다.
- 제한 집계 검토(코드 수정 없음): 현재 limiter는 성공/일반 요청도 network 및 단계별 30회/15분 카운터에 포함한다. ID 상태 GET, 일반 최초 설정 상태 POST, 성공한 마스터 인증, PIN 등록 또는 PIN 로그인 각각이 카운트된다. 첫 인증은 보통 네트워크 카운터 4회(최초 마스터 등록까지 포함하면 5회)를 사용하며, 같은 NAT IP 매장 직원들이 공유한다. 따라서 이 값은 실패 횟수 전용이 아니고 정상 트래픽으로 소진될 수 있다.
- 정책 권고: 보안 기준 30회/15분은 유지하되 의미를 실제 잘못된 마스터 비밀번호/PIN 시도에 적용되는 실패 카운터로 두고, 성공 인증/상태 조회는 실패 카운터에서 제외하는 것이 매장 사용량과 공격 시도를 구분한다. ID 조회 abuse/계정 열거 방지는 별도 요청 카운터·응답 균일화로 다루되, 조회 제한값은 매장 피크 사용량 측정 없이 변경하지 않는다. 본 요청은 추가 코드 수정 금지이므로 정책은 적용하지 않았다.
- DB 접속 시도는 TDK_POS_TEST로 가드했으며 읽기 전용 계정 조회와 승인된 임시 E2E fixture 외에 인증정보 변경은 없었다. 운영 DB는 접근/변경하지 않았다. 이전 단계의 BLOCKED는 사용자가 재시작한 뒤 기능 검증을 진행해 해소됐고, 실제 sondows 인증은 사용자 비밀번호 미제공으로 미검증이다.

## TDKON POS 로그인 전면 교체 및 구형 인증 소스 정리 — 2026-11-01

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ADM 성공 로그인과 POS 기존 로그인/UI/API/페이지 보호 구조 비교 | ProgramTrustGate, POS login page, auth/trust routes, POS session helpers | 없음 | 읽기 전용 | 재사용 API, 중복 호출, 보존해야 할 POS 업무/보조 PIN 참조를 식별 | 참조 검색, route/source 조사, Next Route Handler 문서 확인 | PASS |
| 2 | POS ID 조회에서 직원 활성/퇴사/POS 권한/마스터 상태/POS token을 서버에서 판정 | POS trust status API, shared trust route | 1 PASS | POS 로그인 상태 조회 | 무효 계정 차단, reset/initial setup 상태만 등록 허용, POS 전용 trust만 확인 | route unit/API tests, TDK_POS_TEST | PASS |
| 3 | POS 화면을 ID → 다음 → 등록/마스터 인증 흐름으로 연결 | POS branch in ProgramTrustGate | 2 PASS | POS login UI only | ADM과 같은 단계, ID 유지, 포커스/오류/안내 문구, 불필요한 뒤로가기 제거 | auth-flow tests, TypeScript, ESLint, Chrome | PASS |
| 4 | 공통 POS token/PIN 등록 및 POS PIN 로그인으로 단일 요청 연결, 중복 PIN 사전검증 폐기 | program trust APIs, POS login child, auth login/verify-pin routes | 3 PASS | POS auth endpoints only | POS 전용 HttpOnly token/session, 공통 PIN, login 성공 1회 요청, 참조 없는 구형 route 제거 | route tests, TDK_POS_TEST integration | PASS |
| 5 | POS 페이지/API 인증 및 다른 프로그램 token 차단 확인 | POS page, sales/order/payment APIs, getCurrentStaff | 4 PASS | POS access boundary | POS permission/revocation/session 검사 유지, 주문/결제 코드 변경 없음 | API access audit, guarded negative probes | PASS |
| 6 | 인증 정상/오류/재접속과 ADM·KDS 회귀를 실제 개발 환경에서 검증 | isolated test fixture, Chrome, related tests | 2-5 PASS | 임시 TDK_POS_TEST fixture only | 모든 요구 시나리오 통과, fixture cleanup, 업무 데이터 무변경 | TypeScript, ESLint, unit/API integration, Chrome | PASS |
| 7 | 파일 삭제/변경 목록과 검증 결과를 기록하고 복구 체크포인트 보존 | PLANS.md, .codex-backups | 1-6 results | documentation/checkpoint | 미검증 항목을 분리 표기, 복원 가능한 checkpoint | checkpoint/file check | PASS |

- Stage 1 findings: ADM and POS both use ProgramTrustGate and the same `/api/{program}/trust` plus `enrollProgramTrust`, which calls `verifyMasterPassword` and issues a program-specific trust token. Shared `/api/program-trust/pin` registers the shared employee PIN. POS `/api/auth/login` is the current POS-specific PIN-to-session API and should remain; it creates a POS session linked to the POS token. The old login page calls `/api/auth/verify-pin` and then `/api/auth/login`, verifying the same PIN twice. The UI also fetches `/api/staff/active` and shows an employee picker; that endpoint remains used by POS secondary PIN checks in order summary/table/admin flows and cannot be removed globally.
- Existing gap: POS ProgramTrustGate currently begins with an unscoped trust check and falls into combined ID+master-password UI; there is no POS ID-submit branch. `trustStatus("POS", request)` currently checks token cookies but does not validate a supplied ID's active/terminated/POS permission state. PIN re-entry component is the older staff list/keypad UI. `getCurrentStaff` protects the POS page/session and checks POS permission plus matching non-revoked POS trust. `getPosLoginMode()` is hard-coded PERSONAL. Existing POS work/payment APIs are out of scope for edits.
- Route safety: `/api/auth/verify-pin` is referenced only by the old POS login component; `verifyActiveStaffCredentials` is still used by admin/sales reauthentication and must not be removed. `/api/staff/active` is also used outside login and must remain. No database schema or staff data changes are planned.
- Next.js implementation reference reviewed: installed Next 16 App Router Route Handler docs under `node_modules/next/dist/docs/01-app/...`; request/response handlers use Web Request/Response APIs and GET handlers are not cached by default unless explicitly opted in.
- Pre-change checkpoint to create before step 2: `.codex-backups/20261101-pos-auth-replacement-before.zip` (POS and shared gate/auth source, tests, PLANS).
- Production DB `TDK_POS` is prohibited. Integration fixtures, where schema supports them, must be created and cleaned only in `TDK_POS_TEST`; no real sondows password/PIN will be changed.
- Pre-change checkpoint created: `.codex-backups/20261101-pos-auth-replacement-before.zip`.
- Stage 2 implementation: POS trust status validates the submitted ID against exactly one active, non-terminated, POS-enabled non-shared employee. Registration state is returned only from the explicit reset flag; a POS token is usable only when the master hash exists and the reset flag is clear. Initial setup still requires the existing approved setup or OWNER-reset permission. `program=POS` registration also checks POS access.
- Stage 2 tests: POS status unit tests passed 4/4 for eligible account, reset-only registration, NULL hash without reset denied, and trusted POS token/PIN state.
- POS login UI now starts ID-only, requests `/api/auth/trust?loginId=...` only on Next, branches into approved registration/master auth/PIN, retains ID, focuses the active input, and removes the POS password-stage back link. ADM and KDS branches were not changed.
- POS PIN login now consumes the ID from `ProgramAuthContext` and calls `/api/auth/login` once. Removed unused `/api/auth/verify-pin` endpoint after confirming no remaining source caller; `/api/staff/active` and shared credential helpers remain for secondary reauthentication.
- Chrome POS E2E PASS on localhost:3000 with a random temporary TDK_POS_TEST employee: ID-only screen; retained ID; password and PIN focus; master auth; POS-only token; PIN login; `[data-pos-app]` main page. Network showed one GET `/api/auth/trust`, one POST `/api/auth/trust`, one POST `/api/auth/login`, and no verify-pin call. Browser could not read the HttpOnly trust cookie. DB contained one active 64-hex POS token hash and one linked POS session.
- POS API integration PASS on TDK_POS_TEST: eligible ID 200; unknown/inactive/terminated/POS-disabled ID denied; token enrollment denied for ineligible accounts; PIN without POS trust denied (403); wrong master password and PIN denied (401); successful enrollment/login/reconnect/page returned 200. First PIN registration and subsequent login also passed. All fixture rows were deleted.
- POS access audit PASS: `/tdkpos` without a session redirected to `/tdkpos/login` (307); `/api/pos/menu-catalog` without a session returned 401; `/api/auth/login` without POS trust returned 403. `getCurrentStaff` remains the POS page/API session guard, and all nine `src/app/api/pos/**/route.ts` handlers retain the guard. Order/payment business files were not modified.
- ADM/KDS regression PASS: API integration wrong-password 401, enrollment 200, wrong-PIN 401, login/reconnect/page 200 for both. Existing KDS Chrome registration/master-auth/token/PIN/main-page flow passed after shared gate changes. Temporary test rows/tokens/sessions were cleaned.
- TypeScript passed after `npx next typegen` refreshed generated route types following obsolete route removal. ESLint passed on changed code/scripts; related unit tests passed 11/11. No schema change or production DB access/change.
- Checkpoints: pre-change `.codex-backups/20261101-pos-auth-replacement-before.zip`; after-change `.codex-backups/20261101-pos-auth-replacement-after.zip`; manifest `checkpoints/20261101-pos-auth-replacement-after.md`.

## TDKON 공통 인증 요청 제한 시스템 개선 — 2026-11-01

| 단계 | 목표 | 수정 대상 | 선행 조건 | 영향 범위 | 완료 기준 | 검증 | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ADM/POS/KDS ID·마스터 비밀번호·PIN·등록·IP·429 제한과 저장/만료/호출 경로 전수 조사 | limiter modules, login/status APIs, ingress, schema | 없음 | 읽기 전용 | 정상/실패 요청별 실제 카운터, cross-NAT 경로, 런타임 한계 파악 | source trace, TDK_POS_TEST read-only counters | PASS |
| 2 | 실패 카운터를 직원 및 인증 단계별로 통합하고 성공/입력오류/권한거부를 제외 | shared auth limit helper, ADM/POS/KDS login routes | 1 PASS | 인증 제한만 | 마스터와 PIN 독립, 직원 ID 정규화, 30/15 명시 정책 보장 | unit tests, TypeScript, ESLint | PASS (코드/정적 검증) |
| 3 | ID/status와 PIN 등록 남용 제한을 인증 실패 카운터에서 분리 | ID status, setup APIs, KDS request limiter | 2 PASS | 인증 요청 제한만 | 기존 ID/setup 요청 제한 별도 유지, 정상/실패 인증 분리 | source trace, route unit tests | PASS (코드 검증; 실제 API 미검증) |
| 4 | 30회·31회, 기간 만료, 직원·단계 독립성 검증 | auth limit tests, TDK_POS_TEST fixtures | 2-3 PASS | 테스트 직원만 | 실패만 증가, 최대 30회·31번째 차단, 15분 만료 및 다른 직원 정상 인증 | pure unit tests; API/counter integration pending | IN_PROGRESS |
| 5 | 실제 Chrome에서 정상/실패 인증과 ADM·POS·KDS 회귀 확인 | current dev server, TDK_POS_TEST, Chrome | 4 PASS | 임시 테스트 계정 | 정상 트래픽의 실패 카운터 영향 없음, 여러 직원 NAT 영향 분리 | Chrome KDS/POS PASS; API all programs PASS; ADM Chrome pending | IN_PROGRESS |
| 6 | 결과를 기록하고 복구 체크포인트 생성 | PLANS.md, checkpoints | 1-5 results | documentation/archive | 변경·검증·미완료 항목 보존 | archive inspection | IN_PROGRESS |

- Stage 1 findings: `admin-auth-limit.ts` uses `admin_auth_attempts` with SHA-256 keys for `{scope,account}` and `{scope,ip}`, currently 5/15m; a wrong credential increments both and any success clears both, so one employee can block all staff on the same IP within that scope. Scope strings differ among ADM/POS/KDS, so identical master credentials are not one stage-wide bucket. `admin-login-limit.ts` is a process-local 5/15m map used by POS PIN; KDS layers another 5/15m process-local map over `kds_login_attempts` DB rows for known employees, while unknown IDs are process-local only. ADM PIN uses the shared DB helper and a shared IP bucket.
- KDS additionally calls `reserveKdsIpAttempt` for every ID-status, master-auth, PIN-login, and PIN-setup request. It increments both an IP-wide `network` bucket and an API-scope bucket at 30/15m before credentials are checked. Therefore valid KDS ID lookups, valid master authentication, and valid PIN logins consume the same network budget. ID status and setup should remain on separate abuse/request limits; master/PIN auth should count actual credential failures only.
- Current data is opaque hashed counters, not request telemetry. A read-only query to `TDK_POS_TEST` found `admin_auth_attempts`: 3 rows, 0 active in 15m, historical max 44; `kds_auth_ip_attempts`: 7 rows, 0 active, historical max 36; `kds_login_attempts`: 0 rows. No keys, employee identities, IPs, or secrets were read. Expired rows were not cleared. No historical request logs or traffic baseline were found, so no new ID-abuse threshold should be introduced; existing ID/status and setup caps remain 30/15 where already implemented.
- Existing per-employee credential cap is actually 5/15m in the DB and in-memory helpers, despite the requested policy describing 30/15m. The explicit requested 30 failed attempts then 31st blocked policy is being treated as the target for password/PIN failures; successful and malformed/permission-denied requests will not consume it. Legacy request-count caps remain separate and will not deny valid credentials due to shared NAT failures.
- Counter storage: `admin_auth_attempts` is DB-persistent and shared across processes, with old rows purged only during failed-auth recording; `kds_auth_ip_attempts` is DB-persistent with row-lock transactions and 1-day cleanup; `kds_login_attempts` is DB-persistent but currently duplicated by process-local state and has no automatic stale-row purge. POS/KDS in-memory counters reset on process restart and do not coordinate across processes. DB schema will be reused; no new table or counter reset is planned.

- Implementation: `auth-attempt-policy.ts` now sets the requested 30 failures/15 minutes and allows failure 30 to be recorded; failure 31 is rejected. Hashed keys normalize staff IDs and separate `master-password` from `employee-pin`. `admin-auth-limit.ts` advances persistent rows under transaction/row lock, clears only that employee's stage counter on success, and records IP failures separately. A full IP failure bucket is not checked before valid authentication, so a wrong-password/PIN sequence from one staff member does not block a correct coworker behind NAT. ID/status abuse and setup/recovery requests retain separate existing 30/15 request counters.
- Route changes: POS, ADM, KDS PIN routes now use the shared employee PIN counter; program-token enrollment and password reauthentication share the master-password counter. KDS no longer reserves the shared network+phase request buckets for every PIN login or master-password authentication; valid ID status in ADM/POS/KDS does not consume invalid-ID request buckets. Invalid/ineligible ID status and setup/recovery APIs remain separately request-limited. Malformed requests, missing/ineligible accounts, permission denials, PIN-not-configured responses, and successful verification do not increment credential-failure counters.
- Code verification: `npx.cmd tsc --noEmit` PASS; ESLint on changed TypeScript/MJS files PASS; policy + KDS limiter + KDS PIN route unit tests 12/12 PASS. Unit tests cover normalized/separate keys, employee separation, stage separation, 30th/31st behavior, 15-minute expiry, and KDS not spending a general IP request token before PIN credential checks.
- Runtime verification (2026-11-01): PID 334720 was no longer running; its executable path/command/parent could not be queried after exit. No listener on port 3000 and no `.next/dev/lock` were present; no lock cleanup was needed. `npm.cmd run dev` was started from the project directory and Next logged `D:\10_프로그래밍_소스\01_TDK_Web\tdk-pos` and `DB_NAME=TDK_POS_TEST`. The first sandboxed server could not reach the remote development DB `192.168.0.83` and returned 503 for ADM/POS/KDS status GET. After restarting the local dev server with network access, all three ID/status GETs returned HTTP 200. No production DB was accessed.
- Chrome: isolated KDS login PASS (ID, master registration, master authentication, KDS token, PIN setup, KDS page); cleanup complete. Isolated POS login PASS (ID, master authentication, POS token, PIN login, POS page; one GET status, one POST trust, one POST PIN request); cleanup complete. A temporary ADM Chrome check did not pass because it timed out waiting for the master-password form after the ID step; cleanup completed. Do not count ADM browser flow as verified.
- API integration: `integration-program-trust-test.cjs` passed for POS/ADM/KDS. For each, wrong master password returned 401, token enrollment returned 200, wrong PIN returned 401, PIN login and reconnect returned 200, protected page returned 200, and revoked-token login was denied; fixture, sessions, tokens, and audit rows were cleaned.
- Limit verification boundary: live API integration exercised one wrong master password and one wrong PIN per program and subsequent success. It did not exercise 30/31 requests, real counter values, 15-minute expiry in DB, concurrent requests, or multi-employee NAT behavior. Those limits are unit-tested only. ADM Chrome remains unverified, so stages 4–5 remain IN_PROGRESS.
- Recovery checkpoints: `checkpoints/20261101-common-auth-rate-limit-policy.zip` and `checkpoints/20261101-common-auth-rate-limit-policy-v2.zip` (the latter includes the final ADM ID-status adjustment). These are review/restore points, not Git commits.

### 실제 저장소·동시 요청 최종 검증 — 2026-11-01

- 실행 서버: `npm run dev`에서 시작한 현재 프로젝트 경로의 개발 서버, `DB_NAME=TDK_POS_TEST`. 운영 DB는 접근하지 않았다.
- 격리 직원 4명을 생성해 실제 KDS 인증 API와 `admin_auth_attempts`를 대조했다. 마스터 비밀번호 실패 30회는 각각 HTTP 401, 31회째는 HTTP 429였고 저장 카운터는 30이었다. PIN도 동일한 결과였으며 PIN 실패는 마스터 카운터를 바꾸지 않았다.
- 만료 시각은 DB 테스트 행에 UTC 기준 16분 전을 주입했다. 이후 실제 잘못된 인증은 HTTP 401로 다시 허용되고 마스터/PIN 카운터가 각각 1로 재생성되었다. 따라서 15분 후 차단 해제와 새 카운터 생성은 PASS. 단, 행 자체는 15분 시점에 물리 삭제되지 않는다. 현재 `admin-auth-limit.ts`는 마지막 업데이트 후 1일 지난 행을 요청 처리 중 정리하므로 물리 삭제 정책은 15분 만료와 다르며 이번 검증에서 1일 정리는 기다려 확인하지 않았다.
- 같은 출발 IP(`127.0.0.1`)에서 A의 반복 실패 중에도 B의 PIN 로그인, C의 마스터 인증, D의 정상 마스터/PIN 로그인이 HTTP 200이었다. 정상 로그인 직원의 마스터/PIN 실패 카운터는 모두 0이었다.
- 동시 경계 테스트에서 각 카운터를 29로 설정하고 동일 직원의 잘못된 요청 2개를 동시에 보냈다. 마스터와 PIN 모두 결과는 HTTP 401 1건 + HTTP 429 1건, 최종 저장 횟수 30이었다. 서로 다른 직원 2명도 동시 실패 4회씩 저장되어 카운터 충돌이 없었다.
- 모든 임시 직원, 직원별 카운터, 세션, 토큰 및 감사 행을 스크립트 종료 시 정리했다. 공유 IP 카운터는 테스트 전 스냅샷을 복원했다. 임시 검증 스크립트도 삭제했다.
- ADM API 통합은 앞서 실제 TDK_POS_TEST 격리 계정으로 검증되었으나, ADM Chrome 화면 검증은 완료되지 않았다. 기존 자동 Chrome 시도는 ID 다음 단계에서 비밀번호 화면 대기에 실패했으며 테스트 계정은 정리되었다. 따라서 ADM Chrome 항목은 미검증이고 전체 ADM Chrome PASS를 주장하지 않는다.
- 현재 작업 판정: 요청 실패 저장소의 30/31 경계, 단계 분리, 논리 만료, NAT 직원 독립성 및 원자적 동시 경계는 PASS. 15분 시점의 물리 행 삭제는 미지원/미검증이며, ADM Chrome 회귀 검증은 미검증. 인증 코드와 정책은 수정하지 않았다.

### ADM 실제 Chrome 최종 회귀 시도 — 2026-11-01

- Chrome에서 `http://localhost:3000/tdkadm/login`을 열고 임시 ADM 테스트 직원을 사용해 ID를 입력한 뒤 `다음`을 눌렀다. 브라우저는 아래 세 요청을 모두 실제 서버에 보냈고 HTTP 200을 받았지만, 마스터 비밀번호 화면으로 이동하지 않고 `계정 상태를 확인할 수 없습니다. ID를 확인하거나 관리자에게 문의해 주세요.`를 표시했다.
  - `GET /api/admin-center/trust?loginId=<fixture>` → 200, `{success:true,trusted:false,passwordRegistrationRequired:false,invalidated:false,pinSetupRequired:false}`
  - `GET /api/admin-center/trust/initialize` → 200, `{available:false}`
  - `POST /api/admin-center/trust/initial-master/status` → 200, `{resetPasswordRequired:false}`
- 실제 분기 원인: ADM trust-status 응답은 `masterPasswordConfigured`를 제공하지 않는다. 승인된 초기 설정 쓰기 환경이 아닌 일반 개발 로그인에서 initial-master status API는 등록 상태를 공개하지 않고 `{resetPasswordRequired:false}`만 반환한다. 그러나 `ProgramTrustGate.checkAdmId`는 HTTP 403일 때만 일반 마스터 비밀번호 단계로 진행하고, HTTP 200 응답에 `state`가 없을 때는 오류 안내로 빠진다. 따라서 이 경로의 실패는 Chrome 자동화 문제가 아니라 프런트엔드와 API의 상태 응답 계약 불일치다.
- 실제 master input 화면까지 진입하지 못했으므로 마스터 입력 포커스, 비밀번호 인증, ADM 토큰 발급/쿠키, PIN 로그인 및 재접속은 이번 Chrome 검증에서 미검증이다. 별도 API 통합 테스트의 결과를 브라우저 PASS로 간주하지 않는다.
- 초기 Chrome 스크립트는 DOM 노드를 반환값으로 비교해 ID 입력 대기에서 시간초과가 발생했으나, boolean DOM 확인으로 수정한 뒤 재시도했다. 이후 실제 응답/오류가 재현되어 자동화 대기 오류와 실제 로그인 실패를 구분했다. 모든 임시 직원, 세션, 감사 기록 및 ADM 토큰을 각 시도 후 정리했으며 임시 스크립트와 Chrome 프로필도 삭제했다.
- 코드 변경은 하지 않았다. 사용자 제한에 따라 발견된 분기 불일치 수정은 수행하지 않았다. ADM 실제 Chrome 전체 회귀는 **BLOCKED (프로그램 오류 확인, 수정 금지 조건)** 이며 전체 회귀 PASS로 표시하지 않는다.

### ADM 로그인 상태 분기 수정 및 실제 Chrome 회귀 — 2026-11-01

| 단계 | 목표 | 결과 | 상태 |
| --- | --- | --- | --- |
| 1 | ADM trust/initialize/initial-master API 응답과 프런트 분기 비교 | 정상 비설정 응답 `{resetPasswordRequired:false}`를 프런트가 미인식하던 원인을 확정 | PASS |
| 2 | 응답 필드 기반 화면 분기와 ADM 계정 적격성 확인 연결 | 상태 해석을 `resolveAdmIdStatus`로 통합하고 무효·비활성·퇴사·ADM 미허용 ID는 공통 403 응답 | PASS |
| 3 | 타입, 린트, 단위/API 테스트 | TypeScript PASS, ESLint PASS, 관련 테스트 9/9 PASS | PASS |
| 4 | 격리 직원을 사용한 실제 Chrome 인증 및 예외 검증 | 마스터 입력 자동 포커스, ADM 토큰 쿠키, PIN 로그인, 로그아웃 후 PIN 재접속 모두 PASS | PASS |

- 실제 Chrome Network 응답: 적격 일반 직원은 trust GET 200(`trusted:false`), initialize GET 200(`available:false`), initial-master/status POST 200(`resetPasswordRequired:false`)을 받은 뒤 마스터 비밀번호 입력 단계로 이동했다. `resetPasswordRequired:false`는 로그인 오류가 아니라 일반 인증 분기로 처리한다.
- 화면 검증: 격리 직원 ID → 다음 → 마스터 입력 자동 포커스 → 마스터 인증 200 → ADM 신뢰토큰 DB 기록 1건 및 HttpOnly `tdk_adm_trust_*` 쿠키 → 기존 PIN 로그인 200 → `/tdkadm` 진입. 로그아웃 후 같은 브라우저에서 ID 조회는 PIN 화면으로 분기했고 PIN 로그인 200 후 다시 `/tdkadm`에 진입했다. HttpOnly ADM 세션 쿠키도 확인했다.
- 예외 분기: 존재하지 않는 ID, 비활성 직원, 퇴사 직원, ADM 권한 OFF 직원은 동일한 일반 안내를 보이고 마스터 입력 화면에 진입하지 않았다. 마스터 해시 NULL·등록 플래그 미승인 계정은 비밀번호 입력 화면만 보이고 등록 대화상자는 노출되지 않았다. 명시적으로 재등록 플래그가 설정된 격리 계정만 등록 대화상자에 진입했다.
- 코드 변경: `ProgramTrustGate.tsx`에서 ADM 상태 분기를 공통 응답 결정 함수에 연결하고, 예측하지 못한 응답은 개발 모드에서 민감정보 없이 상태 코드/분기 필드만 기록한다. `program-trust-routes.ts`는 기존 ADM 적격성 조회 결과가 없을 때 기존 별도 남용 제한을 유지하며 같은 일반 403 안내를 반환한다. 비밀번호 검증, 토큰 구조, PIN 검증 및 DB 스키마는 변경하지 않았다.
- Chrome은 설치된 실제 Chrome 바이너리의 격리된 headless 세션으로 실행했다. 모든 테스트 직원, 세션, 토큰 및 감사 기록을 종료 시 정리했고 임시 테스트 스크립트와 프로필을 삭제했다. TDK_POS_TEST만 사용했으며 운영 DB는 접근하지 않았다.
- Checkpoint: `checkpoints/20261101-adm-login-status-branch.zip`.

## TDKON POS 인증 소스 재조사 및 잔여 정리 계획 — 2026-11-01

> 이번 1단계는 읽기 전용 소스 조사다. 소스 코드, API, DB, 직원 데이터는 수정하지 않았고 테스트나 브라우저 검증도 실행하지 않았다. 아래 상태는 현재 코드 정리 계획의 상태이지 런타임 인증의 재검증 결과가 아니다.

### 현재 소스 확인 결과

- POS 로그인 페이지는 `src/app/login/page.tsx`이며 `ProgramTrustGate`에 POS 프로그램으로 연결된다. ID 조회/다음 버튼, 마스터 비밀번호, PIN 단계의 상태 전환은 ADM과 공유하는 `src/components/ProgramTrustGate.tsx`가 담당한다. 기존 ID+비밀번호 동시 입력 폼과 구형 POS `verify-pin` 로그인 API는 현재 소스에 없다.
- POS ID 상태 조회 및 신뢰 토큰 등록/폐기는 `/api/auth/trust`가 `trustStatus("POS")`, `enrollProgramTrust`, `revokeCurrentProgramTrust`로 위임한다. 공통 비밀번호 검증은 `src/lib/master-password.ts`의 `verifyMasterPassword`를 사용한다.
- PIN 등록은 공통 `/api/program-trust/pin` 경로와 직원 공통 PIN 해시/검증을 사용한다. PIN 로그인 후 POS 세션 생성은 POS 전용 `/api/auth/login`이 수행한다. POS trust 쿠키와 POS 세션 쿠키/세션 타입은 POS 전용으로 남아 있다.
- POS 페이지 및 업무 API의 세션 가드는 `getCurrentStaff()`다. 세션 검증은 활성 직원, POS 권한, POS 세션 타입과 POS trust를 재확인한다. POS 로그아웃은 `/api/auth/logout`에서 POS 세션을 종료한다. 기존 POS 업무 페이지/API의 접근 가드는 이번 조사에서 변경하지 않았다.
- POS 이외 업무에서도 사용되는 2차 인증 경로가 남아 있다. `/api/admin/verify-pin`, `/api/admin/verify`는 POS 관리자 재확인에서 사용되고, `/api/staff/active`는 테이블 관리·주문 요약·관리자 재확인 화면에서 호출된다. 이들은 POS 최초 로그인 잔여물로 삭제할 수 없다.
- `verifyActiveStaffCredentials`도 관리자/판매 재확인 호출자가 있으므로 공통 함수에서 삭제하지 않는다. `verifyStaffPin` 및 `verifyAdminStaffPin`의 구형 해시 fallback과 `staff.pinHash` 참조는 현재 로그인 경로와 분리되어 있으나, 이력 데이터·관리 UI·테스트 참조 관계를 추가 확인하기 전까지 삭제 대상으로 확정하지 않는다.
- `admin-login-limit.ts`는 KDS에서도 참조되는 공용 제한 코드다. POS 전용 잔여물로 보아 제거하면 안 된다. 별도 POS 로그인 전용 스타일/인증 상태 모듈은 현재 주 로그인 경로에서 확인되지 않았다.
- 기존 계획 기록에는 `/api/auth/verify-pin`이 이전 POS 로그인에서만 쓰여 제거되었고, POS 흐름의 Chrome/API 검증도 완료되었다고 기록되어 있다. 이번 단계에서는 이를 재실행하지 않았다.

### 분류

| 분류 | 현재 식별 항목 | 처리 방침 |
| --- | --- | --- |
| A. 삭제 대상 | 구형 POS ID+마스터 비밀번호 동시 입력 로그인, 구형 POS PIN 로그인 폼, `/api/auth/verify-pin` fallback API | 현재 소스에서 로그인 경로로 사용되지 않음. `/api/auth/verify-pin`은 이미 제거된 것으로 확인되어 추가 삭제 없음. |
| B. 공통 기능으로 유지 | `ProgramTrustGate`, `verifyMasterPassword`, `verifyEmployeePin`, 공통 PIN 등록·상태/토큰 관리, 공통 직원 상태/권한 검증, 공통 인증 실패 제한 | POS/ADM/KDS가 공유하므로 POS 정리 중 제거·복제하지 않음. |
| C. POS 전용으로 유지 | `/api/auth/login`, `/api/auth/logout`, `/api/auth/trust`의 POS 바인딩, POS trust/session 쿠키 및 세션 타입, POS 접근 권한 검사, `getCurrentStaff()` 보호 경로 | 업무 세션/토큰 경계이므로 유지한다. ADM 토큰이나 세션과 합치지 않는다. |
| D. 추가 검토 필요 | `verifyStaffPin`/`verifyAdminStaffPin` 호환 fallback, `staff.pinHash` 및 `hasLegacyPosPin` 메타데이터, 2차 인증 API와 `/api/staff/active`, 관련 단위 테스트 | 호출 그래프·운영 데이터 호환성·직원관리 화면 의존성을 별도 확인한 뒤 제거 가능 여부 결정. 이번 단계에서는 변경하지 않음. |

### 후속 단계 계획

| 단계 | 작업 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트 방법 | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | POS/ADM 인증 소스 대조 및 잔여 코드 분류 | `ProgramTrustGate.tsx`, POS 로그인 페이지/API, `auth.ts`, POS 2차 인증 호출자, 본 계획 | 없음 | 읽기 전용 조사 및 문서 | 현행 주 경로와 삭제/유지/추가 검토 항목을 근거와 함께 기록 | 정적 호출 검색 및 파일 확인. 실행 검증은 범위 밖 | PASS |
| 2 | 호환 PIN·legacy 메타데이터의 전체 참조와 데이터 의존성 조사 | `src/lib/auth.ts`, 직원관리 API/UI, POS 관리자·판매 재인증, 관련 테스트 및 스키마 정의 | 1 PASS | 공통 인증 보조 함수, 관리자 재인증, 직원관리 표시 | 런타임 호출자, 테스트, 저장 필드와 마이그레이션 이력을 모두 매핑하고 삭제 가능/불가 판정 | 정적 참조 검색, 스키마/마이그레이션 읽기. DB는 읽기 전용이며 운영 DB 접근 금지 | TODO |
| 3 | 확인된 POS 전용 미사용 로그인 잔여물만 최소 정리 | 2단계에서 안전성이 입증된 POS 전용 파일만 | 2 PASS 및 정리 범위 확정 | POS 인증 진입 경로에 한정; 공유 인증 및 업무 경로 제외 | 구형 POS 인증 fallback이 남지 않고 공통 로그인 흐름 하나만 진입점으로 사용 | 관련 단위/API 테스트, TypeScript, ESLint. 실패 시 해당 단계에서 수정 | TODO |
| 4 | POS 인증 회귀 검증 | POS 로그인 API/화면 및 `TDK_POS_TEST` | 3 PASS | ID 조회, master auth, POS 토큰, 공통 PIN, POS 세션/로그아웃 | 격리 직원으로 기존 정상 흐름과 접근 거부 조건이 실제 API 및 브라우저에서 확인됨 | TDK_POS_TEST API 통합과 실제 Chrome. 실제 계정 인증정보 변경 금지 | TODO |
| 5 | 결과 및 복구 지점 기록 | `PLANS.md`, 체크포인트 | 4 PASS | 문서/복구 자료 | 검증 결과, 변경 파일, DB 영향, 미검증 항목을 기록하고 복구 가능한 체크포인트 생성 | 체크포인트 내용 확인 | TODO |

- 현재 결론: POS 최초 로그인 경로의 전면 교체는 이미 반영된 상태로 기록되어 있다. 다음 개발 단계는 재교체가 아니라 2단계의 구형 PIN 해시 호환 경로 및 직원관리 참조 조사를 완료한 뒤, 안전성이 확인된 잔여 코드만 선택적으로 정리하는 것이다.
- 본 조사에서는 DB에 접속하지 않았고 계정/토큰/세션 데이터를 읽거나 변경하지 않았다. 운영 DB `TDK_POS` 접근·변경 없음.

### 2단계 실행 결과 — 구형 PIN 호환 코드 및 메타데이터 감사 — 2026-11-01

| 점검 | 확인 결과 | 상태 |
| --- | --- | --- |
| 과거/현재 PIN 해시 생성 형식 | `hashPin`은 4자리 PIN을, `hashEmployeePin`은 6자리 PIN을 검증하지만 둘 다 `scrypt$16384$8$1$<salt>$<key>` 형식과 동일한 scrypt 파라미터를 사용한다. 해시 문자열만으로 구형/신형 PIN 길이를 판별할 수 없다. 저장 컬럼과 기존 검증 함수 경로로만 구분 가능하다. | PASS (소스 확인) |
| 현재 인증 함수 | `verifyEmployeePin`은 6자리와 `staff.employee_pin_hash`만 확인한다. `verifyStaffPin`은 공통 해시가 없을 때 `staff.pin_hash`의 4자리 PIN으로 fallback하고, `verifyAdminStaffPin`은 `staff.admin_pin_hash`로 fallback한다. 이 두 호환 함수는 테스트 외 런타임 호출자가 없음을 전체 소스 검색으로 확인했다. | PASS (호출 관계 확인) |
| 활성 직원 구형 PIN 데이터 | 조회 스크립트는 `DB_NAME=TDK_POS_TEST`로 강제하고 읽기 전용 연결을 시도했으나 MySQL 연결이 `ECONNREFUSED`로 실패했다. 두 차례 시도 모두 데이터베이스 세션이 생성되지 않아 해시 형식/컬럼별 건수를 확인하지 못했다. 운영 DB에는 연결하지 않았다. | BLOCKED |
| 직원관리 메타데이터 | `pin_hash`, `employee_pin_hash`, `admin_pin_hash`, `kds_pin_hash`는 `staff` 스키마와 `staffColumns`/직원 요약 변환에서 읽는다. 구형 POS 직원관리 API `/api/admin/staff`의 GET은 `employee_pin_hash` 또는 `pin_hash` 존재 여부를 `hasPin`으로 반환하며 POS 관리자 직원관리 화면에서 호출된다. `hasLegacyPosPin`, `hasKdsPin`, `hasLegacyAdminPin` 등 일부 요약 boolean은 현 프런트엔드에서 직접 사용되지 않지만 API 응답/호환 참조를 보존했다. PIN 등록 상태인 `hasEmployeePin`과 `kdsPinChangeRequired` 등은 직원관리/초기화 흐름의 상태 데이터다. | PASS (소스 참조 확인) |
| POS 인증 잔존 코드 분류 | A 유지: POS trust/login/logout, POS 세션/권한 가드, 관리자 재인증, POS 직원관리 GET. B 공유 유지: 공통 마스터/PIN 검증, ProgramTrustGate, 직원 상태/요청 제한. C 제거 가능: 이번 감사에서 현재 존재하는 안전한 삭제 후보를 찾지 못함 (`/api/auth/verify-pin`은 이미 제거됨). D 보존: `verifyStaffPin`/`verifyAdminStaffPin`와 legacy PIN 컬럼/요약 필드 — 실제 개발 DB 사용 건수를 확인할 수 없어 제거 보류. | PASS (분류) |
| 회귀 검증 | PIN/직원관리/KDS 로그인/ADM 보안 관련 단위 테스트 23/23 PASS, `tsc --noEmit` PASS, 관련 파일 ESLint PASS. 이들은 현 코드 베이스라인 검증이며 코드 변경 후 회귀 결과는 아니다. DB/API/Chrome 인증 시나리오는 실행하지 못했다. | PASS (정적/단위) |

- 삭제한 파일·함수·API: 없음. 실제 PIN 데이터가 구형인지 확인하지 못한 상태에서 호환 verifier를 제거하면 직원 계정의 잠재적인 구형 데이터 접근 경로를 잃을 수 있어 삭제하지 않았다. `/api/auth/verify-pin`은 1단계 당시 이미 제거된 상태로 이번 변경이 아니다.
- DB 호환성 조치 제안(미적용): 구형 POS PIN 레코드가 남아 있다면 4자리 legacy hash를 6자리 공통 PIN hash로 변환할 수 없다. PIN 원문을 복원할 수 없으므로 직원이 정상적인 신뢰 토큰을 보유한 세션에서 새 6자리 PIN을 직접 재등록하도록 안내하는 마이그레이션이 필요하다. 건수 확인 전 데이터 초기화/변환은 하지 않는다.
- 현재 결과: 소스 감사는 완료했으나 데이터 건수 확인과 구형 fallback의 제거 여부 결정은 개발 DB 접속 불가로 차단되었다. 코드/DB 변경은 없다. 아래 단계는 이 데이터 확인이 끝날 때까지 진행하지 않는다.

| 단계 | 목표 | 현재 상태 |
| --- | --- | --- |
| 2 | 구형 PIN 해시/메타데이터 사용처와 개발 DB 데이터 의존성 확인 | BLOCKED — `TDK_POS_TEST` 연결 `ECONNREFUSED`; 구형 PIN 컬럼별 건수 미확인 |
| 3 | 확인된 POS 전용 미사용 인증 잔여물 최소 정리 | TODO — 2단계 PASS 선행 필요; 현재 안전한 삭제 대상으로 확정된 코드 없음 |
| 4 | POS 및 ADM/KDS 인증 회귀 검증 | TODO — 코드 정리 이후 격리 계정과 개발 DB/Chrome 필요 |
| 5 | 정리 결과 기록 및 복구 체크포인트 | TODO — 정리 단계 완료 후 생성 |

- 이번 단계 체크포인트: `.codex-backups/20261101-pos-auth-step2-audit.zip` (PLANS.md 문서 스냅샷; 소스는 변경하지 않음).

### 개발 DB 연결 원인 확인 및 PIN 데이터 조사 후속 — 2026-11-01

| 항목 | 결과 | 상태 |
| --- | --- | --- |
| 기존 `ECONNREFUSED` 원인 | 이전 조사 스크립트가 기본 `dotenv.config()`로 `.env`를 찾았으나 프로젝트 설정은 `.env.local`이었다. 환경변수가 로드되지 않아 DB 호스트를 지정하지 못했고 로컬 기본 주소로 연결을 시도했다. 프로젝트 자체의 DB 중단으로 볼 근거는 없었다. 실제 `.env.local`을 읽은 뒤 sandbox 네트워크는 `EACCES`로 차단됐지만, 허용된 읽기 전용 실행에서 원격 DB 연결에 성공했다. | PASS |
| 실제 DB 연결 설정 | `.env.local`에서 민감정보를 제외해 확인: `DB_HOST=192.168.0.83`, `DB_PORT=3306`, `DB_NAME=TDK_POS_TEST`. `server.cjs`는 Next를 실행하며 설치된 Next 런타임은 서버 초기화에서 프로젝트 환경 파일을 로드한다. DB 모듈은 `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`을 사용한다. 실제 SQL `SELECT DATABASE()` 결과는 `TDK_POS_TEST`. | PASS |
| 서비스/Docker 상태 | 개발 DB는 로컬 Docker가 아니라 원격 호스트다. 이 Windows 환경에는 Docker CLI가 없고, `docker-compose.yml`에는 앱 서비스만 있으며 DB 서비스가 정의되어 있지 않다. 로컬 MySQL/MariaDB Windows 서비스와 로컬 3306 listener도 발견되지 않았다. 원격 MySQL은 읽기 전용 접속과 SELECT가 성공해 실행 중임을 확인했다. | PASS |
| 개발 서버 상태 | 확인 당시 로컬 3000 포트 listener가 없었다. 따라서 실행 중인 서버 프로세스의 환경을 직접 검사하지는 못했지만, `npm run dev`에서 사용하는 Next 런타임의 환경 로딩과 `.env.local`의 TDK_POS_TEST 값을 확인했다. 서버 재시작이나 서비스 변경은 하지 않았다. | PASS (설정 확인; 실행 프로세스 미확인) |
| 직원 상태 및 공통 PIN | `TDK_POS_TEST`의 비공용 직원 3명: 활성·미퇴사 2명, 비활성·미퇴사 1명, 퇴사 0명. `employee_pin_hash`는 총 2건이며 두 활성 직원에 각각 1건. 해시 원문 및 직원 ID는 출력하지 않았다. | PASS |
| 구형 POS PIN | `pin_hash`는 총 2건: 활성·미퇴사 1건, 비활성·미퇴사 1건. 활성 1건은 `employee_pin_hash`도 보유해 공통 PIN에 의해 가려져 있으며, 공통 PIN이 없는 활성 계정은 0건. 활성 `pin_hash` 1건의 형식은 scrypt. | PASS |
| 구형 ADM/KDS PIN | `admin_pin_hash` 1건은 활성 직원에 있고 해당 직원은 공통 PIN도 보유한다(활성 fallback 필요 0건). `kds_pin_hash`는 0건. 활성 해시의 형식은 scrypt. | PASS |
| 전체 해시 형식 | 비어 있지 않은 값의 형식별 집계: `employee_pin_hash` scrypt 2건, `pin_hash` scrypt 2건, `admin_pin_hash` scrypt 1건, `kds_pin_hash` 0건. PIN/해시 값 자체는 출력하지 않았다. scrypt 형식은 같은 파라미터를 써 PIN 자릿수나 컬럼의 용도를 단독 식별하지 못한다. | PASS |
| 직원관리 메타데이터 | `/api/admin/staff` GET의 `hasPin`은 공통 PIN 또는 구형 POS PIN 컬럼을 읽어 반환하며 POS 관리자 직원관리 화면이 호출한다. 따라서 그 endpoint와 `pin_hash` 표시 참조는 삭제할 수 없다. ADM 직원관리 응답의 `hasLegacyPosPin`, `hasLegacyAdminPin`, `hasKdsPin`, `hasEmployeePin` 등 요약 boolean은 현재 프런트엔드에서 직접 소비하지 않지만 API 계약 및 기존 저장 컬럼은 보존했다. `kdsPinChangeRequired`는 서버 PIN 등록/재설정 상태 판정에서 사용된다. 실제 인증은 요약 boolean이 아니라 `employee_pin_hash`를 사용한다. | PASS (정적 호출 추적) |
| 소스/데이터 변경 제한 | DB transaction은 `READ ONLY`로 시작하고 SELECT 후 rollback했다. DB 스키마·행·토큰·세션 변경 없음. 이번 요청의 7항에 따라 source edit 금지이며 파일 삭제/수정도 없음. 분석 중 시도했던 로컬 편집은 사전 체크포인트와 파일 해시 대조 후 정확히 복원했다. | PASS |

- 정정: 앞선 하위 절의 `TDK_POS_TEST ECONNREFUSED` 표시는 조사 스크립트가 잘못된 env 파일을 읽은 결과였다. 실제 개발 DB 서비스 중단으로 판정했던 기록은 본 후속 결과로 대체한다. `.env.local`을 읽지 않은 수동 probe의 오류였으며, 올바른 개발 설정으로는 데이터베이스에 연결됐다.
- 구형 POS/관리자 PIN 해시 생성 함수와 `verifyStaffPin`/`verifyAdminStaffPin` 호환 fallback은 런타임 인증 API에서 호출되지 않는다. TDK_POS_TEST에서도 공통 PIN 없이 legacy hash만 가진 활성 직원은 0명이다. 따라서 향후 별도 소스 변경 권한이 주어진 정리 단계에서 해당 미사용 helper와 테스트 fallback만 제거하는 방안은 안전성이 높다. 단, legacy 해시 컬럼과 저장 값은 보존하며 데이터 삭제/자동 변환은 하지 않는다.
- 비활성 직원 1명의 `pin_hash`는 legacy 값으로 보존된다. 계정을 다시 활성화할 경우 현재 공통 인증 흐름에서 공통 PIN이 미등록이면 직원 본인이 새 6자리 PIN을 등록해야 한다. 4자리 PIN 해시를 6자리 PIN으로 직접 변환할 수 없다. 이번 작업에서는 그 직원의 인증정보를 변경하지 않았다.
- 체크포인트: `.codex-backups/20261101-pos-auth-db-readonly.zip` (PLANS.md 기록 스냅샷).

| 후속 단계 | 상태 |
| --- | --- |
| 개발 DB 연결 원인 및 PIN 컬럼별 실제 건수 확인 | PASS |
| POS 전용 미사용 legacy verifier/helper 코드 정리 | TODO — 현 요청의 소스 코드 변경 금지에 따라 다음 승인된 코드 정리 단계에서 수행 |
| legacy hash 컬럼 및 직원관리 표시 호환성 유지 | 유지; DB 스키마/데이터 삭제 계획 없음 |
| 정리 후 POS/ADM/KDS 통합 API·Chrome 회귀 | TODO — 코드 정리 단계 완료 후 실행 |

### POS 인증 2단계 후속 — 구형 PIN 인증 호환 코드 제거 — 2026-11-01

| 확인 항목 | 결과 | 상태 |
| --- | --- | --- |
| 런타임 호출 관계 | `verifyStaffPin` 및 `verifyAdminStaffPin`은 런타임 호출자가 없었고 테스트에서만 참조됐다. POS, ADM, KDS 로그인 및 POS 재인증 경로는 `verifyEmployeePin(pin, employee_pin_hash)`를 직접 사용한다. | PASS |
| 공통 PIN 검증 | `verifyEmployeePin`는 6자리 검증과 `employee_pin_hash`만 사용한다. legacy 4자리 scrypt 해시만 전달한 경우 거부되는 단위 테스트를 추가했다. | PASS |
| 삭제한 인증 helper | `verifyStaffPin`, `verifyAdminStaffPin`, 구형 `verifyPin`/`verifyAdminPin` 및 그 생성·검증용 `hashPin`/`hashAdminPin`과 정책 helper를 `src/lib/auth.ts`에서 제거했다. `src/lib/pin.ts`에서는 legacy `isValidPin`/패턴을 제거했다. DB 컬럼·기존 값은 보존했다. | PASS |
| 직원관리 메타데이터 | `pin_hash`, `admin_pin_hash`, `kds_pin_hash`, `employee_pin_hash`, `/api/admin/staff` 및 PIN 등록 상태 표시는 유지했다. 직원관리 조회 메타데이터와 인증 검증 경로를 분리했다. | PASS |
| 비활성 계정의 legacy PIN | 비활성 직원의 legacy `pin_hash` 데이터는 변경하지 않았다. 로그인 API는 활성 계정·프로그램 권한 검증과 공통 `employee_pin_hash` 검증만 수행하므로 legacy 값만으로 인증되지 않는다. | PASS (소스/단위 검증; 비활성 실계정 변경 테스트 미수행) |
| 관련 자동 테스트 | `employee-pin-auth`, 직원 업데이트, KDS login, program-auth-flow, ADM owner-password 관련 테스트 묶음 22/22 통과. | PASS |
| 정적 검사 | `npx.cmd tsc --noEmit` 및 변경 파일 ESLint 통과. | PASS |
| API 통합 및 브라우저 | 기존 통합 검증에서 POS/ADM/KDS 공통 PIN API 로그인 및 거부 경로 통과, 격리 계정 Chrome POS 로그인과 세션 진입 통과. Chrome ADM/KDS 및 직원관리 화면은 이번 작업에서 직접 확인하지 않음. | 부분 검증 |
| DB 및 운영 영향 | 이번 소스 정리 과정에서 스키마·직원 PIN·마스터 비밀번호·토큰·세션은 변경하지 않았다. 테스트용 격리 계정은 정리했다. 운영 DB `TDK_POS`에는 접근하지 않았다. | PASS |

- 변경 파일: `src/lib/auth.ts`, `src/lib/pin.ts`, `src/lib/employee-pin-auth.test.mjs`, `PLANS.md`. 저장소에는 이전 단계에서 시작된 다른 미커밋 변경도 있어 이 목록은 이번 단계의 변경 범위만 뜻한다.
- 함수 제거 외에는 파일 삭제나 DB 변경이 없다. `PIN_LENGTH=4`는 기존 직원관리 UI 참조 때문에 남겼다. `scripts/create-owner.mjs`와 `scripts/reset-staff-pins.mjs`의 로컬 `hashPin`은 인증 검증 fallback이 아니라 별도 생성/관리 스크립트라 이번 범위에서 수정하지 않았다.
- 체크포인트: `.codex-backups/20261101-pos-auth-legacy-fallback-before.zip` (변경 전), `.codex-backups/20261101-pos-auth-legacy-fallback-after.zip` (변경 후).
- 미검증: 실제 Chrome ADM/KDS 로그인, 관리자 재인증 UI, 직원관리 UI 렌더링. 자동 테스트/API 검증을 브라우저 검증으로 간주하지 않는다.
- 최종 잔존 참조 감사: 로그인/재인증 실행 경로에서 `verifyStaffPin`, `verifyAdminStaffPin`, legacy `verifyPin`, `admin_pin_hash`/`pin_hash` 기반 검증 호출은 남지 않았다. POS 재인증의 불필요한 `staff.pinHash` 조회 필드도 제거했다. 남은 `staff.pinHash`/`adminPinHash`/`kdsPinHash` 참조는 직원관리 메타데이터 조회이며, legacy 생성 스크립트는 인증 verifier가 아니다. 이 마지막 조회 정리 후 관련 테스트 22/22, TypeScript 및 ESLint를 재실행해 통과했다.
### 공통 PIN 인증 통합 회귀 — 실제 서버/Chrome 확인 — 2026-11-01

| 영역 | 실제 확인 결과 | 상태 |
| --- | --- | --- |
| POS Chrome | 격리 직원으로 ID→마스터 비밀번호(자동 포커스)→POS 전용 토큰→공통 PIN→POS 메인 화면 진입. API는 `GET /api/auth/trust`, `POST /api/auth/trust`, `POST /api/auth/login` 각 1회. 토큰 쿠키 HttpOnly 및 DB 해시 저장 확인. | PASS (Chrome 로그인 흐름) |
| ADM Chrome | 실제 DOM에서 ID 단계와 안내 문구는 확인. 전체 로그인을 수행하는 Chrome 하네스는 탭 연결 단계에서 timeout되어 비밀번호·PIN 로그인을 검증하지 못했다. 기존 ADM UI 점검 스크립트도 일반 상태 응답을 403으로 가정했으나 현재 API는 200과 reset 상태를 반환해 해당 낡은 assertion에서 중단됐다. | 미검증 (전체 로그인) |
| KDS Chrome | 격리 직원으로 ID→마스터 비밀번호→KDS 토큰→공통 PIN 등록→KDS 메인 조리 화면 진입. 메인 화면은 표시됐고 테스트 매장 주문은 0건. | PASS (로그인·화면 진입) |
| POS·ADM·KDS API 회귀 | 각 프로그램에서 잘못된 마스터 비밀번호와 PIN은 401, 토큰 발급·정상 PIN 로그인·재접속·페이지 응답은 각 200. | PASS |
| 토큰 프로그램 분리 | 격리 직원으로 여섯 개 교차 조합 모두 403, 각 프로그램 자체 토큰 로그인은 200. ADM 토큰 폐기 뒤 POS/KDS 토큰은 유효. POS·ADM·KDS 로그아웃 API는 모두 200. | PASS (API) |
| KDS 주문 조회 | 인증된 KDS 세션으로 `GET /api/kitchen` 응답 200. 주문/조리 상태 변경은 실제 주문 데이터 보호를 위해 실행하지 않았다. | PASS (읽기만) |
| 직원 인증정보 초기화 API | 임시 OWNER/직원으로 reset 200, 일반 직원 403, POS·ADM·KDS·HOS 토큰 4개 폐기, 활성 세션 0, 재등록 허가·새 마스터 비밀번호·새 PIN 등록 성공. | PASS (API) |
| 직원관리 Chrome | 직원 목록, 기존 PIN 표시, 초기화 확인 팝업·실행 UI를 실제 Chrome에서 확인하려 했으나 CDP 탭 연결이 timeout됐다. 초기화 API 검증은 통과했으나 UI 확인은 미완료. | 미검증 (UI) |
| 정적/회귀 검사 | 관련 자동 테스트 22/22, `tsc --noEmit`, 변경 범위 ESLint 통과. | PASS |
| 테스트 데이터 정리 | `TDK_POS_TEST`에서 테스트 계정 코드 접두사별 잔여 건수 POS Chrome/KDS Chrome/ADM Chrome/직원관리/token matrix 모두 0. 운영 DB는 접근하지 않았다. | PASS |

- 이번 회귀 검증에서는 애플리케이션 인증 소스와 DB 스키마를 수정하지 않았다. 임시 Chrome 하네스는 `%TEMP%`에서 실행 후 제거했다.
- Chrome의 재접속 동작은 API 통합검증으로 확인했으며 POS/KDS 실제 Chrome 스크립트는 로그인 후 로그아웃·재접속까지 수행하지 않았다. ADM 브라우저 전체 로그인과 직원관리 브라우저 UI도 미검증이다. KDS 주문 목록 조회 API는 200이지만 실제 주문/조리 상태 변경은 미검증이다.
- 복구 체크포인트: `.codex-backups/20261101-common-pin-regression-after.zip`.
### 최종 인증 통합 검증 — ADM Chrome 및 직원관리 UI — 2026-11-01

| 확인 항목 | 결과 | 상태 |
| --- | --- | --- |
| 응답 가정의 근본 원인 | same-origin Chrome POST에는 출처 검증이 통과하므로 `initial-master/status`가 HTTP 200과 `{resetPasswordRequired:false}`를 반환한다. Origin 없는 요청은 403이다. 기존 `check-adm-id-next-test.cjs`는 일반 same-origin 요청도 403이라고 예상해 실패했다. 테스트 스크립트를 실제 정책에 맞게 수정했으며 애플리케이션 코드는 변경하지 않았다. | PASS |
| ADM 실제 Chrome 인증 | 격리 OWNER로 ID→다음→마스터 비밀번호 화면 및 자동 포커스→ADM 토큰 해시 저장/HttpOnly 쿠키→기존 PIN 로그인→`/tdkadm` 메인 화면을 확인했다. | PASS |
| ADM 로그아웃·재접속 | 로그아웃 API HTTP 200, 이전 세션 비활성 확인. 같은 Chrome에서 ID를 다시 조회하고 PIN으로 로그인해 ADM 메인 화면에 재진입했다. | PASS |
| 직원 목록·수정 UI | Chrome에서 `/tdkadm/security/staff`에 접속해 격리 직원을 목록에서 확인하고 수정 화면을 열었다. | PASS |
| 인증정보 초기화 확인/취소 | 초기화 버튼과 확인 팝업을 확인했다. 취소 후 테스트 직원의 마스터 해시와 PIN 해시가 유지됨을 확인했다. | PASS |
| 초기화 실행·갱신 | 확인 팝업에서 실행 후 테스트 직원의 마스터/PIN 해시가 NULL, 네 프로그램 토큰 4개가 폐기됐고 수정 모달이 닫히며 목록이 갱신됐다. | PASS |
| 직원관리 인증 상태 표시 | 목록/수정 UI는 직원 ID, 프로그램 권한, 계정 상태와 초기화 기능을 표시한다. 현재 UI에는 마스터 비밀번호 등록 여부, 공통 PIN 등록 여부, legacy PIN 데이터 여부를 나타내는 별도 상태 문구/열이 없다. API 메타데이터와 DB 컬럼은 유지했다. | 미표시 확인 |
| 테스트 및 데이터 정리 | 자동 회귀 22/22 PASS, TypeScript PASS, ESLint PASS. `TDK_POS_TEST` 테스트 계정 접두사 잔여 건수 0. 운영 DB에는 접근하지 않았다. | PASS |

- 수정 파일은 테스트 스크립트 `scripts/check-adm-id-next-test.cjs`와 이 기록뿐이다. 인증 애플리케이션 코드, DB 스키마 및 기존 직원 인증정보는 변경하지 않았다.
- 동일 출처 상태 조회의 실제 응답은 HTTP 200 `{resetPasswordRequired:false}`이며 `GET /api/admin-center/trust/initialize`는 HTTP 200 `{available:false}`였다. 계정 설정 권한이 없으므로 마스터 비밀번호 입력 단계로 진행했다.
- 복구 체크포인트: `.codex-backups/20261101-adm-chrome-staff-ui-final.zip`.
- 최종 Chrome 재실행은 `actualAdmChromeLogin=PASS`, `admPinReconnect=PASS`, `staffListAndEdit=PASS`, `resetCancel=PASS`, `resetConfirmAndRefresh=PASS`를 반환했다. 실제 DOM 검사에서는 `credentialStatusColumn`과 `credentialStatusEditField`가 모두 `NOT DISPLAYED`였다. 재검증 후 임시 직원 계정 접두사 잔여 건수는 각각 0이었다.
## 구형 PIN 시스템 완전 제거 — 1단계 전체 참조 조사 — 2026-11-01

> 이 조사는 이전 POS PIN 조사 기록을 대체하는 최신 스냅샷이다. 이전 기록의 DB 수치는 당시 스냅샷으로 보존하며, 아래 수치는 이번 읽기 전용 접속 결과다.

| 단계 | 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 확인 방법 | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 구형 PIN 전체 코드·DB 참조 조사 | 소스 정적 검색, `TDK_POS_TEST` 읽기 전용 조회, `PLANS.md` | 개발 DB 연결, 대상 DB 확인 | 구형 인증 메타데이터 및 스키마 정리 계획 | 컬럼·데이터·호출관계·삭제 선행조건 기록 | 실제 DB명 확인 후 SELECT, 전체 소스 참조 추적 | PASS |
| 2 | 구형 PIN 서버 코드·API 정리 | `auth.ts`, 소유자 초기화 스크립트, 직원관리/reset API, 테스트·진단 SQL | 1 PASS; 활성 구형 PIN 전용 직원의 공통 PIN 등록/인증 처리 방안 확정 | 초기 계정 생성·직원 인증정보 초기화·관리자 목록 메타데이터 | 런타임/운영 스크립트가 구형 해시를 만들거나 조회하지 않고 공통 PIN만 사용 | 관련 단위/API 테스트, 정적 검색 | IN_PROGRESS |
| 3 | 직원관리 구형 PIN 메타데이터 제거 | `staff-management-server.ts`, `staff-management.ts`, `/api/admin-center/staff`, POS 직원 목록 API/UI | 2단계 코드 정리 | ADM/POS 직원 목록의 PIN 상태 표시 및 권한 선택 | UI가 공통 PIN 상태만 표시하고 오래된 필드를 요구하지 않음 | 직원관리 API/단위 테스트, 공통 PIN 상태 확인 | IN_PROGRESS |
| 4 | 개발 DB의 구형 PIN 데이터 및 컬럼 정리 | 새 전진 마이그레이션, `TDK_POS_TEST` | 2~3 PASS; legacy-only 직원의 공통 PIN 재등록 완료; 명시적 변경 승인 | 직원 PIN 저장 컬럼, 구형 KDS 계정/세션 테이블 | 구형 데이터의 폐기/보존 근거와 복구점 확보 후 구조 정리 | 사전/사후 스키마·건수 비교, 공통 PIN 로그인 회귀 | TODO |
| 5 | POS·ADM·KDS 공통 PIN 회귀 | 인증 API·프로그램 경로 | 4 PASS | POS/ADM/KDS 로그인, PIN 등록·실패 제한 | 세 프로그램의 공유 PIN 인증과 프로그램별 토큰 독립성 유지 | API 통합 및 실제 브라우저 테스트 | TODO |
| 6 | 구형 PIN 최종 잔존 감사 | 전체 소스·DB·마이그레이션 | 2~5 PASS | 배포 준비 및 이력 | 런타임/현재 스키마에 구형 인증 참조가 없고 공통 PIN만 인증에 사용 | 정적 검색, 개발 DB 스키마 확인, 회귀 테스트 | TODO |

### 개발 DB 실측 결과 (모두 ID·해시 미출력)

- 연결 설정은 프로젝트 `.env.local`의 DB 이름 `TDK_POS_TEST`였고, 실제 `SELECT DATABASE()` 결과도 `TDK_POS_TEST`였다. 운영 DB `TDK_POS`는 접속하지 않았다. 조회는 `START TRANSACTION READ ONLY`에서 수행하고 ROLLBACK했다.
- `staff`는 총 4명: 활성·미퇴사 3명, 비활성·미퇴사 1명, 퇴사 0명.
- `staff.pin_hash` (구형 POS PIN): `VARCHAR(255) NULL DEFAULT NULL`; 비어 있지 않은 값 3건(활성 2, 비활성 1). 공통 PIN과 중복 1건, 구형 POS PIN만 있고 공통 PIN은 없는 계정 2건(활성 1, 비활성 1). 활성 구형 전용 1건은 삭제 전에 직원이 공통 PIN을 등록하도록 처리해야 한다.
- `staff.admin_pin_hash` (구형 ADM 관리자 PIN): `VARCHAR(255) NULL DEFAULT NULL`; 1건(활성 1), 해당 값은 공통 PIN도 보유한다. 구형 PIN만 보유한 활성 계정은 0건.
- `staff.kds_pin_hash` (구형 직원별 KDS PIN): `VARCHAR(255) NULL DEFAULT NULL`; 데이터 0건.
- `staff.employee_pin_hash` (현재 공통 6자리 PIN): `VARCHAR(255) NULL DEFAULT NULL`; 2건이며 모두 활성·미퇴사 계정이다. 반드시 유지한다.
- 별도 구형 KDS 계정 저장소 `kds_accounts.pin_hash`: `VARCHAR(255) NOT NULL`, 기본값 없음. 테이블 행 0건이며 연결된 `kds_sessions`도 0건이다. `kds_sessions.kds_account_id` → `kds_accounts.kds_account_id` FK (`fk_kds_sessions_account`)가 있다. `kds_accounts`에는 PK와 `login_id` 유니크 인덱스, 세션 테이블에는 PK·토큰 유니크·계정 인덱스가 있다.
- `staff`의 PIN 해시 컬럼에는 PIN 전용 인덱스나 제약조건이 없다. PIN 참조 뷰·트리거·저장 프로시저는 조회되지 않았다. PIN 컬럼을 이름으로 가진 별도 테이블은 없으며 위 `kds_accounts`가 유일한 별도 인증 테이블이다.
- `staff.kds_pin_change_required` (`TINYINT NOT NULL DEFAULT 1`)는 현재 공통 PIN 등록·직원관리 응답과 연결되어 있어 구형 KDS PIN 해시 컬럼과 동일 취급하지 않는다. `staff.cancel_requires_pin` (`TINYINT(1) NOT NULL DEFAULT 1`)은 POS 취소 재인증 정책 설정이며 PIN 해시가 아니다. 둘 다 이번 조사만으로 삭제 후보에 넣지 않는다.

### 코드·API·UI 참조 및 호출 관계

- 공통 인증 유지: `src/lib/auth.ts`의 `verifyEmployeePin`; POS `/api/auth/login`, ADM `/api/admin-center/login`, KDS `/api/kitchen/auth/login` 및 취소 재인증 API가 공통 `employee_pin_hash`를 검증한다. `src/app/api/program-trust/pin/route.ts`와 `src/lib/program-trust-routes.ts`의 지역 변수명이 `pinHash`여도 실제 조회·저장은 `staff.employeePinHash`다. `/api/staff/active`도 공통 해시 상태만 반환한다. 이 경로들은 삭제 범위가 아니다.
- 구형 PIN 전용 생성/검증 후보: `src/lib/auth.ts`의 `hashKdsPin`·`verifyKdsPin`은 전체 런타임 import/호출 검색에서 호출자가 없었다. `verifyStaffPin`, `verifyAdminStaffPin`, 구형 `verifyPin` 구현은 현재 소스에 없으며 테스트도 해당 export가 없음을 확인하는 형태다.
- 구형 생성 스크립트: `scripts/create-owner.mjs`가 `OWNER_PIN`을 해시해 `staff.pin_hash`에 삽입한다. `scripts/reset-staff-pins.mjs`가 고정 초기 PIN으로 `staff.pin_hash`를 갱신한다. 두 스크립트는 실행하지 않았다. 공통 PIN 체계 전환 후 계정 생성·복구에 잘못된 인증정보를 만들 수 있으므로 2단계에서 공통 등록 흐름으로 바꾸거나 폐기해야 한다.
- 구형 상태 API/UI: `src/app/api/admin/staff/route.ts` GET은 `employee_pin_hash`와 `pin_hash`를 함께 읽고 `hasPin = common || legacyPos`로 반환한다. 이 응답은 `src/app/pos/admin/staff/StaffManagementClient.tsx`의 직원 목록 PIN 상태 표시가 사용한다. 따라서 `pin_hash` 제거 전에 응답을 공통 PIN 기준으로 바꾸어야 한다. 같은 API의 POST와 `/api/admin/staff/[staffId]`, `/api/admin/staff/[staffId]/admin-credentials`는 410 종료 응답이며 구형 DB를 조회하지 않는다.
- ADM 직원관리 메타데이터: `src/lib/staff-management-server.ts`의 `staffColumns`가 `pinHash`, `kdsPinHash`, `adminPinHash`를 읽고 `toStaffSummary`가 `hasLegacyPosPin`, `hasKdsPin`, `hasLegacyAdminPin` boolean을 생성한다. `/api/admin-center/staff`가 이를 JSON으로 반환하고, `src/lib/staff-management.ts`가 타입을 선언한다. 전체 UI 참조 검색상 현재 직원관리 화면은 이 세 legacy boolean을 사용하지 않는다. 따라서 서버 선택/JSON/type은 제거 후보지만, 우선 UI/API 계약 테스트를 확인해야 한다.
- `src/app/api/admin-center/staff/[staffId]/route.ts`는 해당 공통 `staffColumns`로 행을 읽고 갱신 시 구형 해시 값은 수정하지 않는다. 주석은 구형 KDS credentials 보존을 명시한다.
- `src/app/api/admin-center/staff/[staffId]/security-password/route.ts`는 인증정보 초기화 트랜잭션에서 공통 PIN과 함께 `pinHash`, `adminPinHash`, `kdsPinHash`를 NULL 처리한다. 컬럼 제거 후 이 쓰기 필드를 제거해야 한다.
- 구형 KDS 계정/세션: `src/db/schema.ts`의 `kdsAccounts`, `kdsSessions` 정의와 `db-migrations/20261020_kds_tablet_login.sql`만 발견됐다. 런타임 import/쿼리 호출자는 검색되지 않았고 테스트 DB 행도 0건이다. 운영 서버/DB 전체에 대한 부재는 이번 조사로 증명하지 않았다.
- 관련 화면: `src/app/pos/admin/staff/StaffManagementClient.tsx`는 `/api/admin/staff`의 `hasPin`을 표시한다. POS 관리자 인증 화면 `src/app/pos/admin/AdminVerifyGate.tsx`는 `/api/staff/active`를 사용하므로 공통 PIN 상태 기반이며 구형 컬럼과 무관하다. ADM UI에서 legacy metadata boolean을 사용하는 코드는 발견하지 못했다.

### 전체 구형 참조 파일 목록

- ORM 및 런타임/API: `src/db/schema.ts`, `src/lib/auth.ts`, `src/lib/staff-management-server.ts`, `src/lib/staff-management.ts`, `src/app/api/admin/staff/route.ts`, `src/app/api/admin-center/staff/route.ts`, `src/app/api/admin-center/staff/[staffId]/route.ts`, `src/app/api/admin-center/staff/[staffId]/security-password/route.ts`.
- 구형 유지보수/테스트 도구: `scripts/create-owner.mjs`, `scripts/reset-staff-pins.mjs`, `scripts/test-takeout-sale-api.cjs` (OWNER 선정 조건이 `admin_pin_hash` 존재 여부), `scripts/integration-staff-credential-reset-test.cjs` (구형 3컬럼을 요구하고 초기화 검증), `src/lib/admin-access.test.mjs`, `src/lib/staff-update-route.test.mjs`. `src/lib/employee-pin-auth.test.mjs`는 이전 인증 함수 export가 없는 것을 확인하는 회귀 테스트다.
- 마이그레이션/SQL/문서: `db-migrations/20261018_admin_permission.sql`, `db-migrations/20261020_kds_tablet_login.sql`, `db-migrations/20261027_kds_employee_pin.sql`, `db-migrations/20261028_kds_https_devices_totp.sql`, `db-migrations/20261029_admin_managed_devices.sql`, `db-migrations/20261029_unified_employee_pin.sql`, `db-migrations/20261030_admin_owner_security.sql`, `sql/add_admin_login.sql`, `sql/check_staff_login_target.sql`, `deploy/ADMIN-STAFF-SECURITY-MIGRATION.md`.
- 마이그레이션 해석 주의: `20261029_unified_employee_pin.sql`은 `pin_hash` 존재 여부로 `pos_enabled`를 이행하고, `20261018_admin_permission.sql` 및 `20261030_admin_owner_security.sql`은 `admin_pin_hash`를 기존 권한 backfill 판단에 참조한다. 이미 적용한 과거 migration 파일은 이력/신규 설치 순서 보존을 위해 삭제·수정하지 말고, 추후 필요하면 검토한 전진 migration을 추가한다. `staff_common_pin_hos_test.sql` 및 `staff_common_pin_hos_production.sql`의 `employee_pin_hash`는 공통 PIN 컬럼이므로 유지 대상이다.
- `sql/check_staff_login_target.sql`은 구형 해시 값 자체 대신 해시 지문을 계산하는 진단 쿼리다. PIN 관련 감사 목적 외 사용 여부를 확인한 뒤 후속 단계에서 제거/정리한다.

### 삭제/유지 분류

- A — 구형 코드 정리 후보: 미사용 `hashKdsPin`/`verifyKdsPin`; `create-owner.mjs`·`reset-staff-pins.mjs`의 구형 PIN 생성/쓰기 경로; `/api/admin/staff`의 legacy PIN fallback; staff reset에서 구형 컬럼을 NULL 처리하는 부분; 구형 OWNER 선택 조건과 해당 통합 테스트 fixture. 제거 전 공통 직원 생성·PIN 재등록의 기존 절차로 대체되는지 확인한다.
- B — 구형 메타데이터 후보: `hasLegacyPosPin`, `hasKdsPin`, `hasLegacyAdminPin`의 선택·계산·타입·JSON. ADM UI에서 소비되지 않지만 API 계약에서 제거하는 단계가 필요하다. POS 직원 목록 `hasPin`은 common-only로 전환하고 화면 상태가 일치하는지 확인한다.
- C — DB 정리 후보: `staff.pin_hash`, `staff.admin_pin_hash`, `staff.kds_pin_hash`, 데이터 0건인 `kds_accounts`·`kds_sessions` 및 FK/인덱스. 단, 활성 직원 1명은 구형 POS PIN만 있고 공통 PIN은 없다. 해당 직원이 공통 PIN을 직접 등록/검증하기 전에는 `pin_hash`를 제거하면 정상 로그인 준비가 보장되지 않는다. DB 컬럼/테이블 삭제와 데이터 삭제는 별도 승인 및 복구 계획이 필요하다.
- D — 반드시 유지: `staff.employee_pin_hash`, `verifyEmployeePin`, 공통 PIN 로그인/등록/변경 API, 실패 제한, 인증정보 초기화의 공통 PIN 처리, POS·ADM·KDS·향후 HOS 공유 구조. 또한 `cancel_requires_pin`은 POS 업무 정책값이므로 삭제하지 않는다. `kds_pin_change_required`는 공통 PIN 등록 상태 흐름에서 사용되므로 별도 의존성 분석 전 보존한다.

### 다음 단계 진입 기준

2단계에서는 런타임 호출 관계를 다시 확인한 뒤 미사용 KDS 전용 해시 함수와 구형 쓰기 스크립트를 공통 PIN 정책으로 정리하고, `/api/admin/staff`의 `hasPin` legacy fallback 및 staff reset의 legacy 컬럼 참조를 제거한다. 활성 legacy-only 직원은 인증정보를 변경하지 않고 공통 PIN 등록 완료 여부만 확인한다. 3단계에서 ADM 메타데이터 boolean과 타입/API 응답을 정리한다. 4단계의 DB 변경은 TDK_POS_TEST만 대상으로 별도 사용자 승인 후 실행하며, 마이그레이션 이력은 보존한다. 운영 DB `TDK_POS`와 운영 배포는 이 작업에서 다루지 않는다.

- 검증 범위: 정적 참조 및 DB 읽기 전용 조사 완료. 코드 수정 없음, DB 수정 없음, PIN 원문·해시 원문·직원 ID 미출력. 사용자가 이번 단계에서 요청한 것은 조사이므로 애플리케이션 테스트/브라우저 테스트는 실행하지 않았다.
- 복구 체크포인트: `checkpoints/20261101-legacy-pin-stage1.zip` (본 조사 계획과 확인한 코드/SQL의 스냅샷; 비밀 환경파일은 포함하지 않음).
## 구형 PIN 완전 제거 — 2단계 서버 코드 및 생성 기능 — 2026-11-01

| 단계 | 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 테스트/검증 | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 구형 KDS PIN helper 및 PIN 생성 경로 정리 | `src/lib/auth.ts`, 구형 소유자/PIN 초기화 스크립트, takeout API test fixture | 1단계 조사 PASS | 공통 PIN 인증을 유지하며 구형 PIN 신규 저장 방지 | 구형 KDS PIN 함수와 구형 PIN 쓰기 스크립트가 제거되고 테스트 fixture는 공통 PIN 기준 | 공통 PIN/KDS/직원 수정 테스트 19건, TypeScript, 변경 파일 ESLint, 정적 참조 검색 | IN_PROGRESS — 구현 및 위 검증 PASS; DB 변경 금지에 따라 실제 DB 쓰기가 필요한 통합 시나리오는 미실행 |

### 조사 및 변경

- 변경 전 `hashKdsPin`, `verifyKdsPin`, `isValidKdsPin`의 런타임 호출자가 없음을 재검색으로 확인했다. 이 함수들을 `src/lib/auth.ts`에서 제거했다. 공통 `hashEmployeePin`/`verifyEmployeePin`, 내부 scrypt 검증, 프로그램 마스터 비밀번호, KDS 비밀번호 함수는 보존했다.
- `scripts/create-owner.mjs`와 그 입력 래퍼 `scripts/create-owner.ps1`는 `OWNER_PIN`으로 scrypt PIN을 만들어 `staff.pin_hash`에 기록하는 구형 POS OWNER 생성 경로였고, 저장소 참조는 래퍼→스크립트뿐이었다. 두 파일을 제거했다. 초기 OWNER 구성은 기존 ADM 최초 OWNER 설정 절차를 사용한다.
- `scripts/reset-staff-pins.mjs`는 고정된 초기 PIN을 구형 `staff.pin_hash`에 쓰는 스크립트였다. 실행 참조가 없음을 확인하고 제거했다. 실행하지 않았다.
- `scripts/test-takeout-sale-api.cjs`의 OWNER 테스트 대상 선택 기준을 구형 `admin_pin_hash`에서 공통 `employee_pin_hash`로 변경했다. 이 테스트 스크립트는 이번에 실행하지 않았다(개발 DB 행을 변경할 수 있는 통합 경로).
- `src/app/api/admin-center/staff/[staffId]/security-password/route.ts`의 공통 PIN·마스터 비밀번호 초기화, 토큰 폐기, 세션 무효화와 함께 구형 hash 컬럼을 NULL 처리하는 부분은 DB 컬럼 제거 전 임시 정리 동작으로 유지했다. 인증 fallback은 아니다.
- `/api/admin/staff`의 legacy 상태 fallback과 ADM 직원관리 API의 legacy 메타데이터는 이번 작업 범위대로 변경하지 않았다. DB 컬럼·데이터·스키마도 변경하지 않았다.

### 검증 결과

- 개발 DB 읽기 전용 확인: 실제 DB `TDK_POS_TEST`. 활성·미퇴사 계정의 구형 POS PIN만 존재하고 공통 PIN은 없는 상태가 1건 유지됨을 집계로 확인했다. 직원 ID나 해시 값은 조회·출력하지 않았다. DB 쓰기는 하지 않았다.
- 공통 PIN, PIN 정책, 프로그램 인증 흐름, KDS 로그인 API, 직원 수정 경로의 관련 테스트: 19/19 PASS (`node --experimental-strip-types --test ...`). 기본 Node 실행은 TypeScript import 미지원으로 PIN 정책 테스트가 로더 단계에서 실패했으며, TypeScript strip 옵션으로 재실행해 전체 통과했다.
- 변경 대상 ESLint: PASS (`eslint src/lib/auth.ts scripts/test-takeout-sale-api.cjs`).
- TypeScript 검사: PASS (`tsc --noEmit`).
- 정적 검색: 구형 KDS PIN 생성/검증 함수, `OWNER_PIN`, `RESET_PIN`, 삭제한 스크립트의 런타임 참조 없음. 현재 구형 hash를 새로 저장하는 런타임 코드는 없음. 구형 컬럼 조회/메타데이터와 reset 시 NULL 처리 및 과거 migration/test 데이터 fixture는 3단계·4단계 전까지 남아 있다.
- 미검증: 실제 POS·ADM·KDS 브라우저 로그인, POS 관리자 재인증 API와 DB 기반 인증정보 초기화 통합 시나리오. 이 작업은 인증정보 변경이나 DB 쓰기를 금지하므로 수행하지 않았다.
- 복구 지점: `checkpoints/20261101-legacy-pin-stage2.zip`; 직전 상태는 `checkpoints/20261101-legacy-pin-stage1.zip`에 보존했다.

## 구형 PIN 완전 제거 — 3단계 직원관리 API 및 메타데이터 — 2026-11-01

| 단계 | 목표 | 수정 대상 | 선행 조건 | 예상 영향 범위 | 완료 기준 | 검증 | 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3 | 직원관리 API·ORM·타입에서 구형 PIN 참조 제거 | staff 목록 API, staff summary helper/type, credential reset API, ORM schema 및 관련 테스트 | 2단계 코드 정리 | 직원 목록의 PIN 상태와 credential reset | 애플리케이션 코드/DB 쿼리가 세 legacy 컬럼을 참조하지 않고 공통 PIN·권한·세션 처리를 보존 | API mock, 직원관리 회귀, TypeScript, ESLint, 전체 참조 분류 | IN_PROGRESS — 코드/단위 검증 PASS; 실 DB 통합 및 프로그램 로그인 회귀 미수행 |

### 수정 내용

- POS `/api/admin/staff`의 SELECT에서 legacy POS hash를 제거하고 `hasPin`을 `employee_pin_hash`만으로 계산한다. JSON의 기존 `hasPin` 형태는 유지해 기존 화면 계약을 보존했다.
- ADM 직원관리 `staffColumns`, `StaffRow`, `toStaffSummary`, `StaffSummary`에서 구형 POS·ADM·KDS PIN 상태 선택·계산·타입을 제거했다. `hasEmployeePin`과 직원 상태·프로그램 권한·보안 설정 메타데이터는 유지했다. UI는 앞서 확인한 대로 legacy boolean을 소비하지 않아 컴포넌트 레이아웃 변경은 없다.
- `src/db/schema.ts`의 staff legacy hash 매핑과 미사용 `kdsAccounts`·`kdsSessions` ORM 모델을 제거했다. 이 작업은 ORM 소스 정의만 바꿨으며 실제 DB 테이블/컬럼은 변경하지 않았다.
- 직원 인증정보 초기화 API에서 legacy hash 3개에 대한 NULL 대입을 제거했다. 마스터 비밀번호·공통 PIN 초기화, PIN setup state, 모든 프로그램의 신뢰 토큰 폐기, 활성 세션 로그아웃, 감사 로그는 유지했다.
- POS 직원관리의 테스트 fixture와 credential-reset 테스트에서 구형 컬럼을 제거했다. `sql/check_staff_login_target.sql`은 legacy PIN 지문/상태 대신 공통 PIN 등록 여부를 읽도록 변경했다.
- `employee_pin_hash`, `verifyEmployeePin`, 공통 PIN 로그인·등록 흐름 및 마스터 비밀번호 검증은 변경하지 않았다. 직원관리 화면과 로그인 UI도 변경하지 않았다.

### 전체 참조 감사

- A — 런타임/애플리케이션 제거 완료: `src/` 및 `scripts/`에서 `staff.pin_hash`, `staff.admin_pin_hash`, `staff.kds_pin_hash`의 SQL/ORM 접근과 legacy metadata 매핑은 검색되지 않는다. `/api/admin/staff`에는 common-only `employee_pin_hash` 읽기만 남았다. legacy KDS 계정 ORM 모델 참조도 제거했다.
- B — 과거 migration으로 유지: `db-migrations/20261018_admin_permission.sql`, `20261020_kds_tablet_login.sql`, `20261027_kds_employee_pin.sql`, `20261028_kds_https_devices_totp.sql`, `20261029_admin_managed_devices.sql`, `20261029_unified_employee_pin.sql`, `20261030_admin_owner_security.sql`, `sql/add_admin_login.sql`. 이력과 신규 환경의 마이그레이션 순서를 보존하기 위해 수정·삭제하지 않았다.
- C — 문서/체크포인트로 유지: `deploy/ADMIN-STAFF-SECURITY-MIGRATION.md`의 기존 배포 시점 설명, `PLANS.md`의 감사 기록, 앞선 체크포인트는 당시 정책과 상태의 이력이다. 현재 애플리케이션 동작에는 사용되지 않는다.
- D — 테스트 assertion만 존재: `src/app/api/admin/staff/route.test.mjs`와 `src/lib/staff-update-route.test.mjs`는 구형 응답 필드가 다시 나타나지 않음을 검증하기 위해 필드 이름을 문자열로 언급한다. 이는 컬럼 조회/저장/매핑이 아니다. `sql/check_staff_login_target.sql`의 legacy 컬럼 참조는 common-only로 정리했다.
- 프로젝트 전체의 구형 컬럼 검색 결과는 위 historical migration·롤아웃 문서와 부재를 검사하는 테스트 assertion에 한정된다. historical migration 외 실행 가능한 SQL에 대상 legacy 컬럼 쿼리는 남지 않았다.

### 보호 및 검증 결과

- DB에는 연결하지 않았다. DB 컬럼·기존 데이터·활성 legacy-only 직원·토큰·세션은 읽거나 변경하지 않았다. 소스 변경만 수행했다.
- POS 직원 목록 API common-only 응답 테스트, credential-reset mock API 테스트(공통 자격 초기화·토큰 폐기·세션 무효화·감사 기록), 직원 권한 수정 및 PIN 정책/인증 테스트를 포함해 26/26 통과.
- TypeScript `tsc --noEmit`: PASS. 변경 파일 ESLint: PASS. DB 통합 테스트 스크립트는 `node --check` 문법 검증 PASS.
- 미검증: 실제 DB에 대한 직원 목록/상세/수정/초기화 API 실행, 실제 credential reset으로 인한 token/session 무효화, POS·ADM·KDS 로그인 회귀 및 브라우저 확인. 이 단계에서 DB 쓰기는 금지되어 통합 스크립트(테스트 직원 생성·변경·정리)와 실제 인증 경로를 실행하지 않았다. 해당 항목은 PASS가 아니다.
- 복구 체크포인트: `checkpoints/20261101-legacy-pin-stage3.zip`. 단계 2 이후 상태는 `checkpoints/20261101-legacy-pin-stage2.zip`에 보존했다.
## 4단계 실행 결과 — 공통 PIN 전환 및 DB 삭제 사전 검증 — 2026-11-01

### DB 확인 (읽기 전용)

- `.env.local`의 개발 연결 설정과 실제 `SELECT DATABASE()` 결과가 모두 `TDK_POS_TEST`임을 확인했다. `TDK_POS`에는 연결하지 않았다.
- 직원 테이블에는 공통 PIN `employee_pin_hash`, 마스터 비밀번호 `security_password_hash`, 구형 `pin_hash` / `admin_pin_hash` / `kds_pin_hash`가 존재했다. 이번 단계에서 스키마와 직원 인증 데이터는 수정하지 않았다.
- 전체 직원 4명: 공통 PIN 등록 2명, 미등록 2명. 구형 PIN 데이터 보유 3명, 구형 PIN 데이터 없음 1명.
- 활성·미퇴사 직원 3명: 공통 PIN 등록 2명, 미등록 1명. 구형 PIN만 보유한 직원 1명, 공통 PIN과 구형 POS PIN 모두 보유한 직원 1명.
- 구형 PIN만 보유한 활성 직원은 활성, 미퇴사, POS 접근 ON, 공통 PIN 미등록, 구형 POS PIN 데이터 존재 상태였다. 해당 직원의 마스터 비밀번호 해시는 NULL이었다. 즉, 현재 DB에는 보존되어 사용할 기존 마스터 비밀번호가 없어 기존 자격증명 그대로 PIN 전환을 시작할 수 없다. 직원 ID와 인증값은 조회·기록하지 않았다.

### 로그인 흐름 및 격리 통합 테스트

- 코드 확인: `ProgramTrustGate`는 토큰 등록 후 PIN 등록 상태를 확인하고, 공통 PIN이 없으면 `SETUP_PIN` 화면으로 전환한다. `/api/program-trust/pin`은 활성/미퇴사/프로그램 권한과 공통 마스터 비밀번호 또는 최근 토큰 등록 상태를 확인하고 `employee_pin_hash`만 저장한다. 구형 PIN 인증 fallback은 없다. 성공 시 프로그램별 세션을 만들며, 재접속 PIN 로그인은 해당 프로그램 토큰을 요구한다.
- 격리 직원으로 POS 실제 개발 서버 API 흐름을 실행했다. 잘못된 마스터 비밀번호 `401`, POS 토큰 등록 `200`, 안전 쿠키 속성(HttpOnly/Secure/SameSite=Strict), 미등록 PIN 상태, 최초 공통 PIN 등록 및 세션 생성 `200`, 잘못된 PIN `401`, 정상 PIN 로그인 `200`, POS 화면 `200`, 로그아웃, 토큰 유지 확인, 토큰 없는 PIN 로그인 차단 `403`, 토큰을 이용한 재접속 `200`, 토큰 폐기 후 접근 차단까지 스크립트 검증이 통과했다.
- 테스트 직원과 테스트 세션/토큰/감사 레코드 정리는 완료됐다. 사후 읽기 전용 집계에서 직원 수는 4명으로 돌아왔고 `INTG-` 테스트 직원은 0명이었다. 실제 직원, 운영 DB, 기존 직원 토큰/세션은 변경하지 않았다.
- 로그인 실패/상태조회 제한은 IP 범위 카운터를 사용하므로 테스트 중 로컬 개발 IP의 임시 제한 카운터가 갱신될 수 있다. 이 카운터는 직원별 데이터가 아니며 인증 정책에 따라 15분 후 만료된다. 다른 사용자의 카운터를 보존하기 위해 강제로 지우지 않았다.
- 실제 Chrome UI 확인은 하지 않았다. 검증은 실행 중 개발 서버의 실제 HTTP/API 통합 테스트다.

### DB 컬럼 삭제 사전 조건

- 활성 직원 전원이 공통 PIN 보유: **FAIL** (3명 중 1명 미등록)
- 활성 공통 PIN 미등록 직원 0명: **FAIL** (1명 남음)
- POS/ADM/KDS 공통 PIN 흐름: **PASS (소스 경로 확인)**; 이번 실제 통합 테스트는 POS만 수행했다. ADM/KDS 브라우저 검증은 하지 않았다.
- 구형 PIN 인증 fallback 제거: **PASS (런타임 경로 검색)**
- 애플리케이션 런타임의 구형 PIN 컬럼 참조 제거: **PASS**; 현재 참조는 보존된 과거 SQL 마이그레이션 이력에만 남아 있다.
- 직원관리 API/프런트엔드 legacy PIN 메타데이터 제거: **PASS (소스 확인)**
- 과거 마이그레이션 이력 보존: **PASS**

**종합 판정: DB 삭제 준비 미충족.** 활성 직원 1명이 공통 PIN을 등록하지 않았고 마스터 비밀번호 해시도 NULL이다. 이 직원은 기존 구형 PIN으로 로그인할 수 없으며, 소유자 승인하에 유효한 마스터 비밀번호를 먼저 등록한 다음 POS에서 본인이 새 공통 6자리 PIN을 직접 등록해야 한다. Codex는 해당 직원의 인증정보를 설정하거나 변경하지 않았다. PIN 완료 후 읽기 전용 집계로 활성 공통 PIN 미등록이 0인지 다시 확인하고 별도 5단계에서 삭제 여부를 판단해야 한다.

### 상태

- 4단계: **IN_PROGRESS** — 격리 POS API 흐름 PASS, 실제 직원의 전환은 미완료이며 직원 직접 등록 대기.
- DB 컬럼 삭제: 수행하지 않음.
- 잔여 위험: 활성 직원의 마스터 비밀번호가 NULL이므로 먼저 안전한 최고관리자 승인 등록 절차가 필요하다. 실제 Chrome 및 ADM/KDS 실통합 검증은 미실시.
- 체크포인트: `checkpoints/20261101-legacy-pin-stage4.zip`

### 4단계 후속 결과 — 구형 PIN 전용 직원 전환 절차 — 2026-11-01

#### 초기화 API 및 재인증

- `POST /api/admin-center/staff/{staffId}/security-password`는 same-origin 확인, `confirmed: true`, `requireOwnerSecurityAccess()`, 현재 ADM 직원 세션 검증을 요구한다. 대상은 활성·미퇴사 직원만 허용하며 본인 초기화는 거부한다.
- API는 DB 트랜잭션에서 `security_password_hash=NULL`, `employee_pin_hash=NULL`, `security_password_change_required=1`을 기록하고, 해당 직원의 모든 프로그램(POS/ADM/KDS/HOS) 미폐기 토큰을 폐기, ACTIVE 세션을 LOGGED_OUT 처리한 뒤 `STAFF_CREDENTIALS_RESET` 감사 로그를 기록한다. 구형 PIN 컬럼은 읽거나 갱신하지 않는다.
- `POST /api/admin-center/security/owner-password`의 `action=verify`는 현재 로그인 OWNER의 마스터 비밀번호를 `verifyMasterPassword`로 확인하고 성공 시 세션의 `ownerReauthenticatedAt`을 기록한다. 잘못된 비밀번호는 401, 성공은 200이다. 초기화 권한은 이 단기 재인증 상태를 요구한다.
- 격리 OWNER로 잘못된 재인증 401, 올바른 재인증 200, 비 OWNER 초기화 403, OWNER 초기화 200을 확인했다. 초기화 후 토큰 4개 폐기, ACTIVE 세션 0개, 마스터 재등록 대기 플래그 및 감사 기록을 검증했다.

#### 구형 PIN 전용 격리 직원 end-to-end

- `TDK_POS_TEST`에만 활성·POS 허용 직원(마스터 해시 NULL, 공통 PIN NULL, 구형 POS PIN 데이터 존재)을 임시 구성했다.
- 유효한 POS 토큰을 동반해 구형 PIN으로 로그인했으나 HTTP 403 `EMPLOYEE_PIN_NOT_CONFIGURED`로 거부됐다. 구형 PIN fallback은 작동하지 않았다.
- OWNER 초기화 후 기존 POS/ADM/KDS/HOS 토큰 4개 모두 폐기, 기존 세션 0개, 초기 마스터 등록 허용 상태를 확인했다. 구형 POS PIN 값은 초기화 전후 동일하게 보존됐다.
- POS 전용 초기 등록 API로 새 마스터 비밀번호 등록 200, POS 전용 신뢰토큰 발급 200, 공통 PIN 최초 등록 및 세션 생성 200, PIN 로그인 200, POS 화면 200, 로그아웃 200, 토큰을 이용한 PIN 재접속 200을 확인했다. 토큰 쿠키의 HttpOnly/Secure/SameSite 속성도 검증했다. 토큰 없이 PIN만 보낸 요청은 403이었다.
- 별도 기존 인증정보 초기화 통합 테스트에서도 ADM 초기화 후 마스터 재등록, 이전 마스터 비밀번호 거부(401), 새 마스터 인증, 공통 PIN 등록을 확인했다. 테스트 계정과 토큰·세션·감사 레코드는 모두 정리됐다.
- 사후 읽기 전용 확인: 직원 4명, 활성·미퇴사 3명, 활성 공통 PIN 미등록 1명으로 기존 집계와 동일하며, 테스트 직원은 0명이다. 실직원 및 운영 DB는 변경하지 않았다.

#### 실제 직원 적용 절차와 판정

1. OWNER가 ADM에서 **보안 → 직원관리 → 해당 직원 수정 → 마스터 비밀번호 · PIN 초기화**를 선택한다.
2. OWNER 본인의 마스터 비밀번호로 보안 재인증을 완료하고 초기화를 승인한다. 이 작업은 직원의 모든 프로그램 토큰과 세션을 무효화한다.
3. 직원은 POS 로그인 화면에서 ID를 입력하고 **다음**을 누른다. 서버가 초기화 대기 상태를 확인하면 마스터 비밀번호 등록 화면을 표시한다.
4. 직원이 새 마스터 비밀번호를 직접 등록하고, 돌아온 인증 화면에서 새 비밀번호로 인증한다.
5. POS 전용 토큰 발급 후 공통 PIN 등록 화면에서 직원이 새 6자리 PIN을 직접 등록한다. 이후 같은 브라우저에서 ID와 새 PIN으로 재접속한다.

- 실제 직원에게 초기화 버튼을 누르거나 인증정보를 변경하지 않았다. 현재 해당 직원의 마스터 해시는 NULL이며 구형 PIN은 더 이상 로그인에 사용할 수 없다. 따라서 위 절차는 OWNER가 실제 초기화를 승인한 뒤 직원이 직접 진행해야 한다.
- 실제 Chrome UI로 이 절차를 열어 확인하지는 않았다. API 통합과 서버 코드에서의 화면 전환 조건을 확인했다.
- DB 컬럼 삭제 사전 조건은 계속 **미충족**이다. 활성 직원 1명이 공통 PIN 미등록이므로 활성 미등록 수가 0이 된 뒤 별도 5단계에서 다시 판단한다.
- 4단계 상태: **IN_PROGRESS** — 격리 end-to-end PASS, 실제 직원의 직접 등록 및 Chrome 확인 대기.
- 체크포인트: `checkpoints/20261101-legacy-pin-stage4-followup.zip`

## 테스트 직원 삭제 사전 확인 — 2026-11-01

### DB 및 보호 계정 확인

- `.env.local` 접속 설정을 사용했고 각 연결의 `SELECT DATABASE()`를 확인했다. 첫 연결은 `TDK_POS_TEST`, 둘째는 `TDK_POS`였다. 두 DB 모두 읽기 전용 조회만 수행했다.
- 두 DB 모두 직원 행 4개다. `sondows`, `jindows`, 공용 직원(`staff_code=000`)을 확인했다. 보호 계정은 삭제·비활성·권한 변경·인증정보 초기화하지 않았다.
- 개발 DB에서 `sondows`는 활성 OWNER 및 OWNER 멤버십, ADM/POS/KDS 권한, 마스터 해시와 공통 PIN 해시가 설정되어 있다. `jindows`는 활성·권한과 마스터/공통 PIN 해시가 설정되어 있다.
- 운영 DB에서 두 보호 계정은 활성이고 POS/ADM/KDS/HOS 권한이 켜져 있으며 공통 PIN 해시가 설정되어 있다. 두 계정의 `security_password_hash`는 현재 NULL이다. 인증 해시 원문은 읽거나 출력하지 않았고 이 상태를 변경하지 않았다. `jindows`는 `OWNER` 직원 역할이지만 OWNER 별도 멤버십 행은 없으며 그 상태도 그대로 보존했다.

### 삭제 대상 대조 및 참조 검사

- 각 DB에서 표시명 `연습용`, `staff_code=003`인 비활성 직원 1개를 확인했다. 두 DB의 행은 생성일 및 속성이 일치하여 같은 테스트 직원의 개발/운영 사본으로 보인다. 따라서 확인된 테스트 직원은 DB당 1명(동일 계정 사본)뿐이며, 요청된 두 직원 계정과 일치하지 않는다.
- 해당 행은 로그인 ID가 없고 비활성, OWNER 역할 문자열은 있으나 `admin_security_owners` 멤버십은 없다. 생성 시점은 두 DB 모두 2026-09-30이다. 각 DB 감사 로그에는 해당 직원 관련 CREATE 1건과 추가 UPDATE 기록이 남아 있다. 코드 검색에서 이 영구 행을 생성한 테스트 스크립트는 찾지 못했다.
- `staff_code=000`의 `매장 공용` 행은 시스템 공용 계정이며 삭제 대상이 아니다.
- 두 DB에서 직원 테이블을 참조하는 외래키와 정수형 직원 ID 컬럼 참조를 집계했다. `연습용` 행을 가리키는 외래키 및 그 외 직원 ID 컬럼 참조는 0건이었다. 감사 로그는 존재하며 중요 감사 자료로 보존해야 한다.

### 작업 판정

- 삭제 대상은 요청된 “정확히 2명”으로 확인되지 않았다. `연습용` 행을 두 개의 서로 다른 직원으로 간주할 근거도 없다.
- 사용자 지시에 따라 **삭제를 중단**했다. DB 행, 토큰, 세션, 실패 카운터, 인증 설정, 주문/매출 자료를 변경하지 않았다.
- 대상 수가 확인되지 않아 삭제 전 백업을 만들거나 트랜잭션을 시작하지 않았다. 이번 검사는 사전 조사만 수행했다.
- 다음 진행에는 실제 삭제하려는 두 직원의 식별 기준(예: 표시명 또는 직원 코드)이 필요하다. 현재 유일하게 확인된 `연습용` 계정만 삭제하는 것은 본 요청의 2명 조건을 충족하지 않아 실행하지 않았다.
- 상태: **BLOCKED — 삭제 대상 불일치**. 복구 체크포인트 `checkpoints/20261101-test-staff-cleanup-preflight.zip`에는 조사 결과만 포함하며 인증 해시는 포함하지 않는다.

## 테스트 직원 계정 삭제 — 개발/운영 DB 정리 — 2026-11-01

### 대상 및 보호 계정

- `.env.local` 설정으로 접속하고 각 세션에서 `SELECT DATABASE()`를 확인했다. 개발 연결은 `TDK_POS_TEST`, 운영 연결은 `TDK_POS`였다.
- 두 DB에서 보호 대상 `sondows`, `jindows`와 공용 시스템 직원(`staff_code=000`), 비활성 연습용 직원(`staff_code=003`, 표시명 `연습용`)을 구분했다. 연습용 직원은 각 DB에 한 행씩 있어 개발/운영 사본 총 2행을 삭제했다.
- `sondows`, `jindows`의 전체 직원 행 및 관련 OWNER 멤버십·토큰·세션 지문은 각 DB 삭제 트랜잭션 전후 동일했다. 개발 DB에서는 두 계정 모두 마스터/공통 PIN 해시가 설정되어 있고, 운영 DB의 두 계정 마스터 해시는 삭제 전부터 NULL이며 공통 PIN은 설정되어 있었다. NULL 상태도 변경하지 않았다.

### 백업 및 트랜잭션

- 삭제 전 백업을 DB별로 생성하고 DB 이름, 대상 행, 보존 감사 로그 13건의 읽기 범위를 검증했다.
- 백업 위치: `checkpoints/private-staff-cleanup/20261101-TDK_POS_TEST-staff003.json`, `checkpoints/private-staff-cleanup/20261101-TDK_POS-staff003.json`.
- 백업에는 비밀번호/PIN 원문은 없고 해시와 인증 관련 레코드가 들어 있다. DPAPI 암호화는 실행 세션에 Windows 사용자 프로필이 로드되지 않아 사용할 수 없었다. 대신 파일과 폴더 NTFS ACL을 제한해 현재 Windows 사용자, 로컬 사용자 및 SYSTEM만 접근 가능하다. 경로는 `.gitignore`에 추가했다. 백업은 일반 공유/커밋하지 않는다.
- 두 테이블 모두 InnoDB였고 DB별 별도 트랜잭션에서 대상 한 행씩 삭제 후 검증을 통과해 COMMIT했다. 대상과 연결된 토큰, 세션, KDS/공통 인증 실패 카운터는 각각 0건이라 삭제된 인증 종속 행은 없었다.
- 대상과 연결된 감사 로그 13건은 두 DB 모두 그대로 보존했다. 주문/결제/정산/재고/세션 업무 테이블의 행 수는 트랜잭션 전후 같았다.

### 삭제 후 검증

| DB | 삭제 직원 행 | 직원 수 | 보호 계정 | 연습용 계정 | 감사 로그 보존 | 업무 데이터 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `TDK_POS_TEST` | 1 | 4 → 3 | 2명 유지, 지문 일치 | 0건 | 13건 | 건수 동일 |
| `TDK_POS` | 1 | 4 → 3 | 2명 유지, 지문 일치 | 0건 | 13건 | 건수 동일 |

- 미폐기 토큰 0, 세션 0, 인증 실패 카운터 0, 남은 대상 직원 0을 사후 읽기 전용으로 확인했다.
- `sondows`, `jindows` 모두 활성 상태와 권한을 유지했다. 운영 DB 마스터 해시가 NULL인 기존 상태도 유지했다.
- POS 직원 목록 및 직원 수정 관련 단위 테스트 7/7 PASS. 실제 인증 세션을 사용한 직원관리 API 및 Chrome 화면 확인은 수행하지 않았다.

### 보존한 시스템 행

- `staff_code=000`은 사용자 로그인 ID가 없는 POS 공용 시스템 직원이다. 소스에서 cash-check, opening-fund, business-session, rice-stock, takeout API가 이 계정을 직접 조회한다. 개발 DB에는 주문 229건 및 결제 273건 등, 운영 DB에는 주문 1,309건 및 결제 508건 등 다수 업무 레코드가 이 직원 ID를 FK로 참조했다. 요청의 업무 데이터 보존 조건에 따라 이 시스템 행은 삭제하지 않았다.

### 완료 상태

- 두 DB에서 확인된 유일한 연습용 직원 사본 2행 삭제: **PASS**.
- 보호 계정 및 업무 데이터 보존: **PASS (DB 지문/건수 확인)**.
- 시스템 공용 직원 `000`: **유지** — 업무 기능과 기존 거래 참조가 있어 삭제하지 않음.
- 스키마 변경 없음. 체크포인트: `checkpoints/20261101-test-staff-cleanup-final.zip`.

### 공용 직원 `000` 삭제 요청 재검토 — 2026-11-01

- 사용자가 로그인 ID 인증 통일 후 공용 직원 삭제를 요청하여 두 DB의 FK 삭제 규칙과 현재 런타임 참조를 다시 읽기 전용으로 확인했다. 어떠한 DB 변경도 수행하지 않았다.
- `TDK_POS_TEST`와 `TDK_POS` 모두 공용 직원의 업무/감사 외래키가 `RESTRICT`다. 개발 DB에는 주문 생성/승인 229건, 결제 273건, 재고 거래 176건, 세션 개설/종료 218/242건 등이 연결되어 있다. 운영 DB에는 주문 1,309건, 결제 508건, 재고 거래 671건, 세션 개설/종료 538/532건 등이 연결되어 있다. 감사 로그도 staff FK로 연결된다.
- 현재 코드도 POS cash-check, opening-fund, business-session, rice-stock, takeout, checkout, 주문 취소/할인 등에서 `staff_code=000`을 공용 업무 주체로 조회한다. 따라서 ID 기반 로그인으로 통일된 것만으로 업무 공용 직원 레코드의 의존성이 제거되지는 않았다.
- 이 행을 삭제하면 DB FK가 거부한다. FK를 제거하거나 주문/결제/업무 이력을 다른 직원으로 재할당하면 업무 기록의 보존/정확성을 훼손한다. 따라서 삭제하지 않았다. 해당 레코드는 `admin_login_id`가 NULL이고 인증 코드가 `staff_code=000`을 차단하므로 로그인 사용자 계정으로는 사용할 수 없다.
- 재검토 상태: **BLOCKED — 업무 데이터의 RESTRICT FK 및 런타임 의존성**. 공용 직원 레코드를 없애려면 별도 단계에서 공용 모드 업무 귀속을 대체하고 모든 이력 참조를 보존하는 데이터/코드 마이그레이션 계획이 먼저 필요하다.

### 공용 직원 `000`을 `sondows`로 귀속 변경 후 삭제 — 2026-11-01

- 사용자가 공용 직원 참조를 `001` (`sondows`)로 모두 변경한 뒤 공용 직원 행을 삭제하도록 명시적으로 요청했다. `.env.local` 설정으로 연결하되 각 연결에서 `SELECT DATABASE()`를 확인했으며, 개발 `TDK_POS_TEST`와 운영 `TDK_POS`를 구분해 작업했다.
- 변경 전 `000` 직원 행과 그 직원 ID를 참조하는 모든 FK 행의 PK/참조 컬럼 값을 제한된 로컬 백업에 저장하고 파일을 다시 읽어 검증했다. 백업은 `checkpoints/private-staff-cleanup/20261101-TDK_POS_TEST-shared000-reassignment-backup.json`, `checkpoints/private-staff-cleanup/20261101-TDK_POS-shared000-reassignment-backup.json`에 있으며 해당 디렉터리는 현재 Windows 사용자, `sondo`, SYSTEM만 접근 가능하고 Git에서 제외된다.
- `TDK_POS_TEST`: 19개 참조 컬럼의 값 1,752건을 `001` 직원 ID로 변경하고 `000` 직원 행 1건을 삭제했다.
- `TDK_POS`: 18개 참조 컬럼의 값 5,654건을 `001` 직원 ID로 변경하고 `000` 직원 행 1건을 삭제했다.
- 변경에는 주문/접수 담당, 결제/체크아웃, 현금 시재, 재고, 테이블 세션, 취소/할인뿐 아니라 `audit_logs.staff_id`와 이미 로그아웃된 POS 세션 이력도 포함된다. 사용자의 “전부” 요청에 따라 과거 귀속도 `sondows`로 변경된 점을 기록한다.
- 두 DB 모두 업무 테이블 행 수는 변경 전후 동일했다. 커밋 후 읽기 전용 확인에서 `000` 행 0건, 과거 `000` 직원 ID를 참조하는 FK 값 0건, `sondows`와 `jindows` 직원 행 각 1건을 확인했다. 트랜잭션 중 `sondows` 및 `jindows` 직원 레코드 지문도 변경 전후 동일했다.
- 소스에서 해당 생성 스크립트의 다른 호출자를 찾지 못해 `scripts/ensure-shared-staff.mjs`를 제거했다. POS 공용 로그인 모드는 현재 소스에서 `PERSONAL`로 고정되어 있다.
- 완료 상태: **PASS** — 두 DB의 참조 이관 및 `000` 행 삭제, 보호 계정 유지, 업무 테이블 행 수 보존 확인.

## 개발·운영 DB 구조 비교 감사 — 2026-11-01

### 접속 및 권한

- `.env.local` 설정을 사용해 DB별 별도 연결을 열고 각각 `SELECT DATABASE()`로 이름을 확인했다. `TDK_POS_TEST` 및 `TDK_POS`에 정확히 연결됐다. 두 연결 모두 MariaDB `10.11.18`, NAS 호스트 `AS5304T-SON`, 포트 `3306`이다.
- 현재 계정의 SELECT 읽기는 성공했다. 개발 DB에서 `SHOW CREATE VIEW`는 `SHOW VIEW command denied`로 거절됐다. 읽기 전용 감사 외에 권한 변경이나 쓰기 SQL은 실행하지 않았다.

### 전체 구조 비교

| 항목 | TDK_POS_TEST | TDK_POS | 결과 |
| --- | ---: | ---: | --- |
| 테이블/뷰 객체 | 91 (기본 테이블 85, 뷰 6) | 91 (기본 테이블 85, 뷰 6) | 이름 및 테이블 엔진/Collation 동일 |
| 컬럼 | 753 | 754 | DIFF |
| 인덱스 엔트리 | 324 | 324 | 구조 및 순서 동일 |
| 외래키 컬럼 | 120 | 120 | 참조 대상과 ON DELETE/UPDATE 동일 |
| 뷰 | 6 | 6 | 이름과 출력 컬럼 구조 동일, 정의 비교는 개발 DB 권한으로 미완료 |
| 트리거 | 0 | 0 | 동일 |
| 프로시저/함수 | 0 | 0 | 동일 |
| 이벤트 | 0 | 0 | 동일 |

- 확인된 실질 컬럼 차이: `staff.hos_enabled`는 운영에만 존재하고, `managed_devices.device_type`은 개발에서 `ENUM('POS','KDS','ADM','HOS')`, 운영에서 `ENUM('POS','KDS')`다.
- 컬럼 위치 차이 34건은 `employee_pin_hash` 및 ADM/HOS 기기 필드가 각 DB에서 다른 위치에 추가된 데 따른다. 그 밖의 컬럼 자료형, NULL, 기본값, AUTO_INCREMENT/추가 속성, 문자셋 및 Collation은 일치한다.
  - `staff`: 개발 `employee_pin_hash` 6번, 운영 22번. 이에 따라 `kds_enabled`, 구형 PIN/KDS 필드, `admin_login_id`, `role`, 인증 필드 등의 순서가 이동한다. 구체적인 다른 이동 컬럼은 `kds_enabled`, `kds_pin_hash`, `kds_password_hash`, `kds_totp_secret_enc`, `kds_totp_pending_secret_enc`, `kds_totp_pending_expires_at`, `kds_pin_change_required`, `admin_login_id`, `admin_pin_hash`, `admin_permission`, `role`, `is_active`, `cancel_requires_pin`, `created_at`, `updated_at`, `admin_enabled`, `security_password_hash`, `security_password_change_required`, `terminated_at`이다.
  - `managed_devices`: 개발에만 있는 enum 값/필드와 추가 위치 차이로 `adm_enabled`, `hos_enabled`, `token_hash`, `request_token_hash`, `confirmation_code`, `registered_by_staff_id`, `requested_at`, `request_expires_at`, `approved_at`, `created_at`, `last_used_at`, `expires_at`, `revoked_at`, `updated_at` 순서가 달라졌다.
- 여섯 뷰 이름은 양쪽에 모두 있다: `v_daily_menu_sales`, `v_daily_theoretical_ingredient_usage`, `v_inventory_status`, `v_open_table_sessions`, `v_session_order_totals`, `v_supplier_payables`. 운영 DB의 확인 가능한 정의는 모두 `TDK_POS.` 스키마를 명시적으로 참조한다. 개발 DB는 `SHOW VIEW` 권한이 없어 실제 정의를 읽지 못했다. 따라서 개발 뷰가 `TDK_POS_TEST`를 참조하는지 확인되지 않았으며, 개발 뷰가 운영 데이터를 읽을 가능성을 배제할 수 없다. 권한을 얻어 정의를 대조하기 전까지 개발 뷰 사용에 주의가 필요하다.

### 직원·인증 구조 및 데이터

- 두 DB 모두 직원은 2명이며 `sondows`, `jindows`가 존재한다. `000` 공용 및 `003` 연습 직원 행은 없다. 두 삭제 직원 ID의 staff FK 참조 및 인증 관련 토큰/세션 참조도 각각 0건이다.
- `sondows`는 두 DB에서 활성 `OWNER`이며 `admin_security_owners` 멤버십 1건, POS/ADM/KDS 권한이 있다. `jindows`도 활성 상태이고 POS/ADM/KDS 권한이 있다. HOS 권한은 운영에서 양 직원 ON, 개발에서 양 직원 OFF다.
- `security_password_hash`: 개발 등록 2명, 운영 등록 0명. `employee_pin_hash`: 각 DB 2명 등록, 활성·미퇴사 직원의 공통 PIN 미등록은 양쪽 모두 0명이다. 인증 해시값은 조회하거나 출력하지 않았다.
- 구형 컬럼 `staff.pin_hash`, `staff.admin_pin_hash`, `staff.kds_pin_hash`는 양쪽 모두 남아 있다. 비 NULL 레코드는 각각 개발 1/1/0건, 운영 2/2/0건이다. 구형 PIN 컬럼 값은 현재 공통 PIN 인증과 별개다.
- 인증 관련 테이블 구조는 양쪽에 존재한다. 데이터는 개발 `program_trust_tokens` 8건(유효 7, 폐기 1), 운영 0건이다. `staff_sessions`는 개발 181건, 운영 208건이다. `admin_auth_attempts`는 개발 16건/운영 0건, `kds_auth_ip_attempts`는 8건/1건, `kds_login_attempts`는 양쪽 0건이다. 토큰/세션 원문이나 해시는 출력하지 않았다.
- 직원 세션 상태는 개발 활성 POS/ADM/KDS 각 1건, 운영 활성 POS 4건/ADM 10건/KDS 3건이다. 관리 기기는 개발 POS 승인 1건·KDS 폐기 1건·ADM 거부 1건, 운영 POS 승인 3건·KDS 대기 1건·승인 2건으로 데이터 상태가 다르다. `admin_security_owners` 멤버십은 양쪽 모두 `sondows` 1건, `jindows` 0건이다.

### 데이터 행 수 차이

업무 데이터의 개발/운영 행 수는 목적과 사용 이력이 달라 다르며 스키마 차이와 구분한다. 전체 기본 테이블 중 34개에서 행 수가 달랐다. 주요 항목:

| 테이블 | TEST | 운영 |
| --- | ---: | ---: |
| `orders` | 331 | 1,411 |
| `payments` | 274 | 551 |
| `checkouts` | 142 | 518 |
| `audit_logs` | 144 | 111 |
| `inventory_transactions` | 202 | 749 |
| `table_sessions` | 303 | 585 |
| `program_trust_tokens` | 8 | 0 |

- 그 외 행 수 차이가 확인된 테이블: `admin_auth_attempts` (16/0), `business_sessions` (3/2), `checkout_items` (516/2,098), `customer_prepaid_ledger` (52/17), `daily_closing_snapshots` (1/6), `discount_rules` (1/2), `kds_auth_ip_attempts` (8/1), `kds_party_table_order` (4/0), `kds_table_order` (10/4), `kds_tasks` (156/303), `managed_devices` (3/6), `master_password_recovery_grants` (4/0), `menu_modifier_groups` (13/15), `modifier_groups` (10/12), `modifier_options` (42/50), `order_item_cancellations` (160/65), `order_item_options` (131/321), `order_items` (684/2,146), `party_groups` (51/43), `payment_method_settings` (3/5), `payment_methods` (7/8), `payment_other_details` (24/9), `payment_session_allocations` (348/602), `staff_sessions` (181/208), `system_settings` (25/15), `table_session_discounts` (10/44), `table_session_merges` (29/0). 업무 행은 수정하지 않았다.

### Migration 상태

- DB 안에서 migration 이력/ledger 테이블을 찾지 못했다. 저장소에는 `db-migrations` 아래 SQL 파일 49개가 있으나 파일명만으로 실행 여부를 확정할 수 없다. 따라서 전 migration의 실제 적용 시점/파일 이력은 확인 불가이며, 아래는 파일 의도와 현재 구조를 대조한 결과다.
- `staff_common_pin_hos_test.sql`: 파일은 개발 DB용 `hos_enabled` 추가를 선언하지만 현재 개발 `staff.hos_enabled`가 없다. `employee_pin_hash`는 존재한다. 개발 DB 적용 여부가 부분적이거나 이후 구조가 되돌아간 상태로 확인 필요.
- `staff_common_pin_hos_production.sql`: 운영에는 `employee_pin_hash`와 `hos_enabled`가 모두 존재한다.
- `managed_devices_add_adm_hos.sql`: 개발 DB의 ADM/HOS 확장은 반영됐고 운영은 `device_type`이 POS/KDS만 허용하며 ADM/HOS 필드 확장이 없다. 파일 자체도 운영 반영은 승인 후로 명시하므로 현재 차이는 승인 대기 변경으로 보인다.
- `20261029_program_trust_{test,production}.sql` 계열 구조는 양쪽에서 동일하게 확인됐다. 실제 적용 파일 이력은 ledger 부재로 확정할 수 없다.
- `20261031_retire_shared_staff_account.sql`은 `000` 직원을 보존하는 구형 의도를 문서화하지만, 현재 두 DB에서는 최근 요청에 따라 `000` 행이 삭제되고 참조가 `sondows`로 변경돼 있다. 이 파일은 현재 데이터 변경 이력을 나타내지 않으므로 재실행하지 않는다.

### 분류 및 권고

- **A. 동일:** 모든 테이블/뷰 이름, 스토리지 특성, 인덱스, 외래키, 트리거/루틴/이벤트 개수. 인증 테이블 구조도 양쪽에 존재한다.
- **B/C/D. 구조 차이:** `staff.hos_enabled` 운영 전용, `managed_devices`의 ADM/HOS 확장 개발 전용, 관련 컬럼 순서 차이. 전체적으로 개발과 운영은 일치하지 않는다.
- **E. 데이터 차이:** 업무 테이블 행 수, 직원 HOS 권한, 마스터 해시 등록 상태, 신뢰 토큰 및 실패 카운터가 다르다. 이는 실제 운영 데이터 차이이며 자동 복사 대상으로 삼으면 안 된다.
- **F. 확인 필요:** 개발 DB의 6개 VIEW 정의는 `SHOW VIEW` 권한 부족으로 확인하지 못했다. 운영 VIEW 정의는 `TDK_POS`를 명시하므로 개발 VIEW 정의를 읽기 권한으로 확인하기 전까지 운영 DB 참조 가능성이 남는다. 적용 migration ledger도 없다.
- DB 변경은 수행하지 않았다. 구조를 통일한다면 현재 소스가 요구하는 개발 구조를 기준으로 개발 DB를 먼저 보완·검증하고, 승인된 migration만 운영에 별도 적용하는 순서를 권고한다. 특히 HOS는 향후 개발 범위이므로 권한을 자동 활성화하지 않는다. VIEW 정의 확인과 기능 영향 검토를 통합 migration의 선행 조건으로 둔다.
- 최종 결론: **STRUCTURAL DRIFT**. 알려진 구조 차이가 있고 개발 VIEW 정의도 권한 부족으로 검증되지 않았다.
- 조사 체크포인트: `checkpoints/20261101-db-structure-audit.md`.

## TDKON 개발 DB → 운영 DB 직원·인증 동기화 — 2026-11-01

### 결과: PARTIAL

- 대상 연결을 각각 `SELECT DATABASE()`로 확인: 기준 `TDK_POS_TEST`, 대상 `TDK_POS`.
- 두 DB 모두 직원은 `sondows`, `jindows` 두 명뿐이었다. 각 직원의 운영 `staff_id`는 보존했다.
- 운영 직원 레코드 2건에 개발 기준 이름/직원 코드/로그인 ID/역할/활성·퇴사 상태/POS·ADM·KDS 권한/관리 권한/인증 정책 필드를 동기화했다.
- `security_password_hash`, `employee_pin_hash`를 개발 DB 값과 직접 비교해 동일함을 확인했다. 평문과 해시값은 기록하지 않았다.
- `admin_security_owners`의 OWNER 멤버십과 `admin_security_settings`의 로그인 ID 매핑은 이미 양 DB에서 같아 변경하지 않았다.
- 운영 전용 `staff.hos_enabled` 컬럼은 미래 HOS 권한 구조를 위해 보존했다. 개발 DB에 대응 권한 컬럼이 없어 두 직원 값은 0으로 설정했다.
- 운영의 `sondows`, `jindows` 활성 세션 17건을 `LOGGED_OUT` 처리했다. 두 직원의 활성 프로그램 신뢰 토큰은 변경 전 0건이었으며 변경 후에도 0건이다. 개발 토큰/세션은 복사하지 않았다.
- 구형 PIN 컬럼은 보존했고 데이터를 변경하지 않았다. 운영 DB 재조회 집계는 POS 구형 PIN 2건, 관리자 구형 PIN 2건, KDS 구형 PIN 0건이다.
- 운영 업무 데이터는 변경 전후 행 수와 전체 행 SHA-256 지문이 같았다: orders 1,419, payments 551, checkouts 518, audit_logs 111, inventory_transactions 752, table_sessions 587.

### 구조 변경 및 미완료 항목

- `managed_devices.device_type`을 개발 기준 `ENUM('POS','KDS','ADM','HOS')`로 확장하려 했으나 DB 계정에 `ALTER` 권한이 없어 거부되었다. 해당 DDL은 적용되지 않았고 현재 운영 값은 `ENUM('POS','KDS')`이다. 기존 데이터는 POS 3건, KDS 3건으로 확인했다.
- `staff.hos_enabled`는 운영에만 존재하며 보존했다.
- 사전 비교에서 확인한 34개 컬럼 순서 차이는 SQL 호환 영향이 없어 그대로 두었다.
- 6개 VIEW 정의는 개발 DB 계정의 `SHOW VIEW` 권한 부족으로 개발 정의를 읽을 수 없어 비교·동기화하지 않았다. 운영 VIEW는 변경하지 않았다.
- 개발 DB migration ledger가 없어 파일 목록만으로 실제 적용 이력을 판정할 수 없다.
- 따라서 두 DB 전체 구조 동기화는 완료되지 않았으며 결론은 `PARTIAL`이다. DB 관리자 권한으로 ENUM 확장 및 VIEW 정의 비교를 별도 진행해야 한다.

### 백업 및 복구 체크포인트

- 운영 전체 스냅샷: `checkpoints/private-staff-cleanup/20261101-TDK_POS-full-before-auth-sync.json.gz` (압축 해제 및 행 수/무결성 검증 PASS).
- 개발 직원·인증 스냅샷: `checkpoints/private-staff-cleanup/20261101-TDK_POS_TEST-staff-auth-before-sync.json.gz` (무결성 검증 PASS).
- 실제 복구 테스트는 격리 DB가 없어 수행하지 않았다. 백업 파일은 보존하며 접근 제한 ACL을 유지한다.
- 세부 결과: `checkpoints/20261101-production-sync.md`.
## TDKON 개발 기준 운영 DB 스키마 SQL 생성 — 2026-11-01

### 결과: SQL 초안 생성 / 전체 동기화 실행본은 BLOCKED

이번 작업은 `.env.local`에서 접속 설정을 읽어 두 DB에 각각 연결하고 `SELECT DATABASE()`로 확인했으며, DB는 읽기 전용으로 조사했다. SQL 파일은 생성했지만 실행하지 않았다.

### 최신 스키마 비교

- MariaDB 10.11.18, 기본 문자셋/Collation은 두 DB 모두 `utf8mb4` / `utf8mb4_unicode_ci`.
- 양쪽 모두 기본 테이블 85개와 VIEW 6개. 테이블 이름/엔진/테이블 Collation은 일치.
- 컬럼 수: TEST 753, 운영 754. 컬럼 이름 추가/누락은 `staff.hos_enabled`(운영에만 존재) 1건.
- 컬럼 정의 차이: `managed_devices.device_type`만 다름. TEST `ENUM('POS','KDS','ADM','HOS')`, 운영 `ENUM('POS','KDS')`.
- 컬럼 순서 차이 34건은 `staff` 20개, `managed_devices` 14개. 타입/기본값/NULL/기타 속성 변경을 동반하지 않음.
- 인덱스 정의 324항목 비교 결과 차이 없음. 외래키 컬럼/참조/ON DELETE/ON UPDATE 120항목 차이 없음.
- 트리거, 프로시저/함수, 이벤트는 양쪽 모두 0개.
- VIEW 6개 이름/메타데이터는 확인. 운영 VIEW 정의는 읽을 수 있으나 TEST의 `SHOW CREATE VIEW`가 `ER_TABLEACCESS_DENIED_ERROR`이고 `information_schema.VIEWS.VIEW_DEFINITION`도 NULL이다. 따라서 각 VIEW의 실제 정의 및 참조 테이블/DB를 양쪽 비교하지 못했다. CREATE OR REPLACE SQL은 생성하지 않았다.
- QRS 문자열 및 객체는 소스/마이그레이션 검색에서 확인되지 않았다. QRS 구조 변경 SQL은 만들지 않았다.

### 소스 참조 판단

- HOS 권한은 `src/db/schema.ts`, `src/lib/program-trust.ts`, 직원관리 API/화면에서 참조한다. 운영 `staff.hos_enabled`를 제거하면 현재 HOS 권한 기능 및 향후 HOS 동작에 위험이 있으므로 DROP SQL은 만들지 않았다. 개발 DB 스키마가 현재 코드보다 뒤처져 있어, 개발 스키마를 별도 승인 절차로 보완하는 편이 안전하다.
- `managed_devices` CRUD/인증 런타임 호출은 현재 소스에서 확인되지 않았다. 다만 Drizzle schema는 ADM/HOS ENUM을 선언하고 있으며 컬럼 확장은 기존 POS/KDS 데이터를 바꾸지 않는 비파괴 변경이다. 운영 값은 POS 3건, KDS 3건이었다.
- 34개 위치 차이는 `staff`와 `managed_devices`에 국한된다. 관련 테이블 대상 `SELECT *` 또는 컬럼 목록 없는 `INSERT ... VALUES` 사용은 찾지 못했다. 별도 검색된 `SELECT *`는 legacy_daily_sales 및 명시적 파생 events 쿼리로, 위치 차이 대상 테이블이 아니다. 따라서 위치만 맞추는 ALTER는 생성하지 않았다.

### 생성 파일 및 실행 범위

- `sql/schema-sync/01_preflight.sql`: 양 DB 메타데이터/키/객체 및 주요 업무 테이블 행 수, 직원 인증 해시 일치 여부를 값 노출 없이 확인한다. VIEW SHOW 권한 필요.
- `sql/schema-sync/02_production_schema_sync.sql`: 운영 `managed_devices.device_type` ENUM 확장 1건만 포함. 실행 시 관리 기기 행을 변경하지 않는다. HOS 컬럼 차이와 VIEW는 해결되지 않으므로 전체 동기화본이 아니다.
- `sql/schema-sync/03_verify.sql`: 컬럼/인덱스/FK/VIEW/객체와 직원 인증정보·업무 행 수 확인용 SELECT.
- `sql/schema-sync/04_rollback.sql`: 향후 ENUM 확장 후 ADM/HOS 타입 행이 전혀 없을 때에만 ENUM을 POS/KDS로 되돌리는 절차. DDL 자동 커밋이므로 트랜잭션 롤백이 아니다.

### 예상 권한, 순서 및 위험

1. 전체 백업 및 변경 창 확보.
2. 개발 DB에 `SHOW VIEW` 읽기 권한을 부여받고 6개 정의를 확보한다. 정의의 DB 참조와 테이블 참조까지 비교한 후 02에 정확한 CREATE OR REPLACE VIEW를 추가한다.
3. HOS 컬럼은 현재 코드가 사용하므로 제거하지 않는다. `TDK_POS_TEST`를 HOS 지원 구조로 별도 승인 하에 보완하고 양 DB를 재비교한다. 이 절차가 끝나기 전에는 스키마 완전 일치를 주장하지 않는다.
4. DBA가 운영 `managed_devices`에 필요한 ALTER 권한을 제공한 뒤 01 출력과 DDL을 검토하고 02를 실행한다.
5. 03을 실행하고 업무 테이블 행 수를 01 결과 및 백업과 비교한다.

컬럼 위치를 맞추는 DDL은 만들지 않았다. 02의 ENUM 변경은 허용값만 추가하는 변경이다. 04는 ENUM 이후 ADM/HOS 데이터를 생성했을 때 데이터 손실 위험이 있으므로 사전 COUNT 결과가 0일 때만 실행해야 한다. 운영 직원/인증정보, 주문/매출/정산/재고/감사 데이터, 토큰/세션을 수정하는 SQL은 생성하지 않았다.

### DB 실행 여부

네 SQL 파일 모두 생성만 했으며 실제 DB에서 실행하지 않았다. 기존 운영 DB 변경은 이 작업에서 수행하지 않았다. 상세 체크포인트: `checkpoints/20261101-schema-sync-sql.md`.
### VIEW 참조 테이블 보충 확인

운영 DB의 6개 VIEW 정의에서 읽은 테이블 참조는 다음과 같다: `v_daily_menu_sales` → `order_items`; `v_daily_theoretical_ingredient_usage` → `order_items`, `menu_recipes`, `inventory_items`; `v_inventory_status` → `inventory_items`; `v_open_table_sessions` → `dining_tables`; `v_session_order_totals` → `orders`; `v_supplier_payables` → `suppliers`, `purchase_payment_allocations`. 개발 DB 정의는 권한 거부로 확인하지 못했으므로 운영 참조와 같다고 판정하지 않았다.
## TDKON DB 동기화 SQL 선행 정보 확보 — 2026-11-01

### DB/VIEW 권한 확인

- 두 DB에 각각 연결해 `DATABASE()`, `CURRENT_USER()`, `USER()`를 확인했다. 개발 접속 주체는 `tdk_pos@%`이며 네트워크 사용자 표시는 로컬 접속 호스트를 포함한다.
- `SHOW GRANTS`를 확인했다. 결과에는 MariaDB 인증 verifier가 포함될 수 있어 원문을 계획/체크포인트에 저장하지 않았다. 개발 스키마에는 `SHOW VIEW`가 없고, 운영 스키마에는 조회 권한이 있다.
- 개발 VIEW 6개의 `SHOW CREATE VIEW`는 모두 `ER_TABLEACCESS_DENIED_ERROR`. `information_schema.VIEWS.VIEW_DEFINITION`도 사용 가능한 정의를 반환하지 않았다. 운영 VIEW 6개는 조회 가능하다.
- DBA 최소 권한 SQL은 `sql/schema-sync/00_dba_show_view_grant.sql`: `GRANT SHOW VIEW ON TDK_POS_TEST.* TO 'tdk_pos'@'%';`. 실행하지 않았다. 권한 승인·적용 뒤 `05_view_definition_extract.sql`로 정의를 읽을 수 있다.
- 운영 VIEW의 현재 참조 테이블: `v_daily_menu_sales`→`order_items`; `v_daily_theoretical_ingredient_usage`→`order_items/menu_recipes/inventory_items`; `v_inventory_status`→`inventory_items`; `v_open_table_sessions`→`dining_tables`; `v_session_order_totals`→`orders`; `v_supplier_payables`→`suppliers/purchase_payment_allocations`. TEST 정의가 없어 스키마 한정 및 참조 일치 여부는 미확인이다.

### HOS 컬럼 정의 및 코드 사용

- 운영 `staff.hos_enabled`: `TINYINT(4)`, NOT NULL, 기본값 `0`, COMMENT 빈 문자열, EXTRA 없음, 운영 컬럼 순서 23, 관련 인덱스 없음.
- 개발 DB에는 컬럼이 없다. 현재 소스의 Drizzle staff schema, `program-trust.ts`, 직원관리 API/UI, trust-token API, 직원 종료 및 최초 설정 경로가 HOS 권한을 참조한다. 운영 컬럼을 삭제하는 방식은 현재 앱 기능을 위험하게 하므로 제외한다.
- 개발 DB에 동일한 정의를 추가하기 위한 검토 SQL: `sql/schema-sync/06_development_hos_column.sql`. `AFTER employee_pin_hash`는 가독성 배치이며 전체 컬럼 위치 정렬은 하지 않는다. 기존 직원 행은 DEFAULT 0을 받는다. 실행하지 않았다.

### managed_devices 판단

- 런타임의 managed-device CRUD/API 참조는 찾지 못했다. 다만 Drizzle ORM 선언과 `staff_sessions.managed_device_id` 읽기 경로가 남아 있고, 양 DB 모두 FK `fk_staff_sessions_managed_device`가 `ON DELETE SET NULL / ON UPDATE RESTRICT`로 연결돼 있다.
- 실제 레코드 및 토큰성 값이 남아 있다. TEST는 3행(POS 승인 1, KDS 폐기 1, ADM 거부 1), 운영은 6행(POS 승인 3, KDS 대기 1·승인 2)이다. 토큰 원문은 조회·기록하지 않았다.
- 결론: 즉시 삭제 대상이 아니라 HOS/QRS 완료 후 세션 FK 및 레거시 토큰 데이터 정리 계획을 거쳐 검토할 DB 정리 후보다. ENUM 확장은 현재 런타임에서 쓰이지 않고 레거시 데이터가 있어 운영 실행 대상으로 확정하지 않았다.

### SQL 초안 재검토 및 수정

- `01_preflight.sql`: `CURRENT_USER()`/`USER()`와 안전한 SHOW VIEW 권한 조회를 추가했다. SHOW GRANTS 원문은 인증 verifier 노출 가능성 때문에 SQL 출력 파일에 넣지 않았다.
- `02_production_schema_sync.sql`: 이전 ENUM 확장 실행문을 제거하고 BLOCKED 게이트로 수정했다. 현재 확정 가능한 전체 운영 DDL은 없다. HOS 제거와 추측 VIEW SQL은 금지했다.
- `03_verify.sql`: 읽기 전용 비교 쿼리로 유지. 해시 값 자체를 반환하지 않고 일치 여부만 확인한다.
- `04_rollback.sql`: 실행 가능한 운영 롤백 DDL을 제거했다. HOS 개발 컬럼을 나중에 롤백할 때는 값이 모두 기본값인지 확인한 뒤에만 검토하도록 DROP 예시를 주석 처리했다.
- `05_view_definition_extract.sql`: DBA 권한 확보 후 사용할 VIEW SHOW CREATE 목록.
- `06_development_hos_column.sql`: 개발 DB HOS 컬럼 추가안.
- 전 파일은 생성/검토만 했고 SQL, GRANT, migration을 실행하지 않았다. 소스와 두 DB도 수정하지 않았다.

### 완전 동기화 SQL 가능 여부와 후속 순서

현 단계에서는 완성된 운영 동기화 SQL 생성 불가. 원인은 TEST VIEW 정의 미확보, HOS 권한 컬럼의 dev/prod 불일치, managed_devices 최종 유지 정책 미확정이다.

1. DBA가 제한된 SHOW VIEW 권한만 TEST 계정에 부여.
2. 6개 VIEW의 TEST/PROD `SHOW CREATE VIEW` 결과 및 DEFINER/SQL SECURITY/테이블 참조를 비교.
3. 개발 DB HOS 컬럼 추가 SQL을 별도 승인 후 실행하고 정의/기본값 확인.
4. HOS/QRS 완료 시점에 managed_devices와 세션 FK·레코드 정리 정책 결정.
5. 최신 구조 재비교 후 02에 정확한 production DDL 및 view SQL을 생성하고 03/04를 맞춘다.

세부 체크포인트: `checkpoints/20261101-schema-sync-prerequisites.md`.
## Docker runtime 파일 누락 재발 방지 — 2026-11-01

### 상태

- 런타임 의존성 분석: **PASS**. `server.cjs`가 `kds-ingress.cjs`, `src/lib/owner-setup-mode.cjs`, `next`를 require하고 `kds-ingress.cjs`도 owner setup 모듈을 require한다. 복구 스크립트는 `mysql2/promise`, `dotenv`를 필요로 한다.
- Dockerfile 런타임 복사: **PASS**. `src/lib/owner-setup-mode.cjs`를 기존 `node:node` 소유권 규칙으로 복사하도록 추가했다. 기존 HEALTHCHECK, `USER node`, ingress 환경변수/검증은 변경하지 않았다.
- 빌드 시 런타임 누락 검증: **PASS (검증기 구현)**. `scripts/verify-runtime-files.cjs`를 추가했고 런타임 이미지 파일 복사 뒤 실행한 다음 `/tmp` 검증기를 제거하도록 Dockerfile에 연결했다. 누락 파일, 로컬 require, production package resolution, CJS 구문 오류를 발견하면 이미지 빌드를 실패시킨다.
- 정적 CJS 검사: `server.cjs`, `kds-ingress.cjs`, `owner-setup-mode.cjs`, 검증기 모두 `node --check` 통과.
- 로컬 의존성 검증기는 Next 빌드 산출물이 있던 시점에 4개 CJS 파일 그래프 및 `next` 로딩 경로를 확인해 PASS했다. 이후 빌드 실패로 `.next/BUILD_ID`가 없어졌고, 재실행 시 이를 감지해 의도대로 FAIL-CLOSED했다.

### 미검증 / 차단

- Docker CLI 및 podman/nerdctl/buildah가 이 환경에 없어 별도 태그 이미지 빌드, 이미지 내부 검사, 컨테이너 서버 시작, 실제 Docker HEALTHCHECK는 수행하지 못했다.
- `npm.cmd run build`는 Next 설정 로딩 후 Google Fonts(`fonts.googleapis.com`) 네트워크 fetch 실패로 중단됐다. 해당 오류는 외부 네트워크 제한이며 Dockerfile 변경과 무관하다. 따라서 production build PASS 및 실제 runtime startup은 판정하지 않았다.
- 운영 NAS·운영 DB·컨테이너·볼륨에는 접근하거나 변경하지 않았다.

### 변경 파일 및 복구 지점

- `Dockerfile`: runtime owner 모듈 COPY와 임시 이미지 검증 단계 추가.
- `scripts/verify-runtime-files.cjs`: runtime CJS local/package 의존성 검증기 추가.
- 상세 체크포인트: `checkpoints/20261101-docker-runtime-copy.md`.

테스트 이미지 확인은 Docker 실행 환경에서 별도 태그(예: `tdk-pos:runtime-check-20261101`)로 빌드한 뒤 이미지 내부 검증기 통과, 서버 준비/종료, HEALTHCHECK 응답을 확인하는 순서로 남아 있다. 운영 태그 `tdk-pos:1.0.0`은 덮어쓰지 않는다.
### 검증기 보충 확인

최종 검증기에는 package.json의 모든 production dependency resolve 검사도 포함했다. production build 실패 후 재실행 결과 유일한 오류는 `.next/BUILD_ID` 누락이었다. 이는 실패한 Next 빌드 산출물이 없음을 정확히 차단한 것이며, 로컬 모듈 및 production package resolve 오류는 보고되지 않았다.
## TDKON Google Fonts 로컬화 및 Docker 빌드 안정화 — 2026-11-01

### 조사 결과

- `src/app/layout.tsx`에서 `next/font/google`의 `Geist`와 `Geist_Mono`를 사용했고, CSS 변수는 `--font-geist-sans`, `--font-geist-mono`였다. 두 글꼴 모두 가변 폰트 굵기 `100 900`, normal style, `font-display: swap`을 사용했다.
- 기존 Next 개발 산출물의 실제 Google font 서브셋을 확인했다. Geist Sans 5개, Geist Mono 6개이며 CSS의 unicode-range 선언과 각 woff2 파일을 그대로 대응시켰다. 외부 폰트 URL은 앱 소스에서 추가로 발견되지 않았다.
- Geist 공식 저장소의 OFL 1.1 라이선스를 확인하고 `public/fonts/OFL.txt`에 포함했다. Geist 글꼴은 OFL 조건에 따라 소프트웨어에 번들해 배포할 수 있다. (공식 라이선스: https://github.com/vercel/geist-font/blob/main/OFL.txt)

### 변경 및 보존

- `src/app/layout.tsx`: Google 폰트 빌드 플러그인 호출을 제거하고 기존 HTML 레이아웃 클래스는 유지했다.
- `src/app/globals.css`: 원본 글꼴명, 100–900 굵기, `swap`, 서브셋별 unicode-range, fallback metric, CSS 변수 연결을 로컬 `@font-face`로 옮겼다. 레이아웃 및 색상 규칙은 수정하지 않았다.
- `public/fonts/`: 기존 빌드 산출물에서 가져온 Geist Sans/Mono woff2 11개와 `OFL.txt`를 추가했다. 폰트 파일 합계는 146,464 bytes다.
- 기존 Dockerfile의 `owner-setup-mode.cjs` 복사와 `verify-runtime-files.cjs` 검사, `node` 사용자, HEALTHCHECK 및 ingress 설정은 보존했다. Git commit/push는 수행하지 않았다.

### 검증

- TypeScript `npx tsc --noEmit`: PASS.
- 전체 `npm run lint`: 실행 중 `.pos-runtime/chrome-profile/Default/Extensions`의 Chrome 확장 파일까지 순회하며 장시간 진행되어 중단했다. 폰트 변경 파일 대상 `npx eslint src/app/layout.tsx`: PASS. CSS는 프로젝트 ESLint 대상이 아니다.
- 후속 `npm run lint -- --ignore-pattern .pos-runtime/** --ignore-pattern .next/**`: FAIL. 기존 코드와 백업 폴더에서 33 errors / 5 warnings가 보고됐다. 변경한 `layout.tsx`는 개별 ESLint 검사 PASS이며 보고된 오류 파일은 이번 작업에서 수정하지 않았다.
- `npm run build`: PASS. Google Fonts 네트워크 요청 없이 production 빌드가 완료됐고 `.next/BUILD_ID`가 생성됐다. 빌드 과정에서 `src/lib/menu-image-storage.ts`의 동적 파일시스템 접근에 관한 기존 Turbopack 경고 2건이 출력됐으며 이번 폰트 변경과는 별도다.
- 소스 및 빌드 산출물의 `next/font/google`, `fonts.googleapis.com`, `fonts.gstatic.com` 참조 검색: 없음.
- production CSS의 로컬 Geist URL 11개가 모두 `public/fonts` 파일로 연결되는지 확인: PASS.
- `node scripts/verify-runtime-files.cjs .`: PASS (`4 CommonJS files`).
- Docker 이미지 빌드 및 이미지 내부 폰트 파일/서버 시작/HEALTHCHECK 검증: 미검증. 이 개발 환경에서 Docker, Podman, nerdctl, buildah CLI를 찾지 못했다. Dockerfile은 `public` 전체를 런타임 이미지로 복사하므로 로컬 폰트도 포함되는 구성이다.
- DB, 앱 인증 및 업무 코드, 운영 자원 변경: 없음.

### 단계 상태

- 폰트 사용처·굵기·라이선스 조사: PASS
- 로컬 폰트 전환: PASS
- TypeScript 및 변경 파일 ESLint: PASS
- 외부 Google Fonts 없이 production 빌드 및 BUILD_ID: PASS
- 기존 런타임 의존성 검사기: PASS
- 실제 Docker 이미지 및 HEALTHCHECK: BLOCKED (Docker CLI 부재)

복구 체크포인트: `checkpoints/20261101-google-fonts-localization.md`.

## NAS 실제 HTTP ingress 403 진단 계측 — 2026-11-01

### 코드 경로 및 판정 근거

- `server.cjs`의 Node HTTP 요청 콜백은 `prepareKdsIngressHeaders(request, ingressConfig)` 결과가 `untrusted`이고 운영 모드이면 `Cache-Control: no-store`와 함께 403을 반환한다.
- `kds-ingress.cjs`의 Caddy 판정은 소문자화한 수신 Host와 `publicHost`의 정확한 일치, 그리고 `x-tdk-proxy-origin-secret`의 `validSecret()` 일치를 모두 요구한다. `validSecret()`은 64자리 hex 형식을 확인하고 `timingSafeEqual`로 비교한다.
- `prepareKdsIngressHeaders()`가 인증 헤더를 삭제하므로 요청 수신 직후 원래 Host와 헤더 존재·길이 및 비교에 필요한 값만 읽어 둔 후, 반환값이 `untrusted`일 때 진단 로그를 남기도록 했다. 원문 비밀키는 로그에 포함하지 않는다.

### 수정 및 로그 형식

- 수정: `server.cjs`에 `TDK ingress rejected`와 JSON 진단 필드 추가. `kds-ingress.cjs`에서 기존 `validSecret()`을 서버 진입점에 재사용하도록 export. `src/lib/kds-ingress.test.mjs`에서 허용/차단 응답과 로그 필드 및 비밀키 미노출 검증 추가.
- 로그 필드: `receivedHost`, `publicHost`, `hostMatches`, `originSecretPresent`, `originSecretLength`, `expectedSecretLength`, `secretMatches`, `ingress`, `remoteAddress`, `nodeEnv`.
- ingress 조건, HTTPS 판단, 403 응답, Caddy 설정, 환경변수, DB, 로그인 정책은 변경하지 않았다.

### 검증 및 현재 상태

- `node --check server.cjs` 및 `kds-ingress.cjs`: PASS.
- `npx tsc --noEmit`: PASS.
- 변경 파일 ESLint (`server.cjs`, `kds-ingress.cjs`, `src/lib/kds-ingress.test.mjs`): PASS.
- `node --experimental-strip-types --test src/lib/kds-ingress.test.mjs`: 10/10 PASS. 기존 허용 요청 200, 차단 요청 403, 로그는 `untrusted`에서만 출력, 비밀키 원문 미출력 검증. 일반 `node --test`는 이 Windows Node 22.17 환경에서 테스트가 import하는 `.ts` 파일을 로드하지 못해 실패했으며 타입 제거 옵션으로 재실행했다.
- `git diff --check`: PASS.
- 실제 NAS HTTP 요청의 로그는 아직 확보하지 않았다. 403의 구체적인 원인은 **BLOCKED**: 변경 코드가 운영 서버에서 실행되고 동일 요청의 진단 로그가 수집돼야 `hostMatches`, `secretMatches`, 소켓 주소를 판별할 수 있다. 운영 배포·설정 변경은 수행하지 않았다.

### 단계 상태

- 실제 요청 경로·기존 판정 로직 조사: PASS
- `untrusted` 전용 진단 계측: PASS
- 로컬 구문·TypeScript·ESLint·ingress 회귀 테스트: PASS
- 실제 NAS 요청의 차단 원인 확정: BLOCKED (운영 로그 미수집)

복구 체크포인트: `checkpoints/20261101-ingress-diagnostics.md`.

## POS 외부 HTTPS 접근 차단 및 내부·외부 주소 통합 — 2026-11-02

### 원인 확인

- 외부 POS 경로는 `src/proxy.ts`에서 `isTrustedPosNetwork()`를 요구했다. 이 판정은 별도의 `caddy-vpn-validated` 표시와 Caddy가 증명한 LAN/VPN 클라이언트 IP를 모두 요구하므로, 유효한 HTTPS Caddy ingress라도 일반 외부 클라이언트는 POS 화면 및 `/api/auth/*`에 도달하기 전에 차단된다.
- 반면 ADM과 KDS의 공개 HTTPS 경로는 같은 POS LAN/VPN gate를 사용하지 않는다. 마스터 비밀번호 및 PIN 등록 API는 공통 `isHttpsSameOriginRequest()`와 ingress가 설정한 `x-tdk-verified-https`를 사용한다.
- POS 내부 IP HTTP에서는 화면과 상태 조회가 가능해도 운영 모드 마스터 인증·토큰 발급에서 HTTPS same-origin 검사가 실패한다. `Secure` 신뢰 쿠키와 HTTPS PIN 등록 조건도 유지해야 하므로 이 동작은 의도된 차단으로 판단했다. 내부에서도 같은 HTTPS 도메인을 사용하도록 split DNS 또는 NAT loopback이 필요하다.
- 운영 NAS의 활성 Caddy 설정과 실제 Chrome 요청은 이번 작업에서 조회하지 않았다. 따라서 운영 403의 계층별 실측은 미검증이다.

### 수정 및 보안 범위

- `src/proxy.ts`: 공개 POS 표면과 POS alias 통과 조건을 네트워크 IP가 아닌 Node ingress가 검증한 HTTPS 표시로 변경했다. 잘못된/임의 브라우저 헤더는 `server.cjs` ingress가 먼저 삭제하며, Caddy origin secret 검증이 통과한 경우에만 표시를 재설정한다.
- POS 직원 ID, 프로그램 권한, 마스터 비밀번호, 신뢰 토큰, PIN, 세션 검증은 변경하지 않았다. HTTPS 검사, Secure/HttpOnly 쿠키, Caddy 비밀키 검증, ADM·KDS 경로 및 QR/주문 API 로직도 수정하지 않았다.
- `src/lib/host-access.ts` 및 관련 ingress/host 테스트에 verified HTTPS ingress 판정을 명시하고 위조 표시 제거 및 POS 경로 gate를 확인하도록 보강했다.

### 검증 및 상태

- 관련 POS/ADM/KDS ingress·인증 테스트: 28/28 PASS.
- 전체 테스트 중 alias 미지원 테스트 한 개(`src/lib/initial-owner-setup.test.mjs`)를 제외한 기존 테스트: 233/233 PASS.
- 전체 테스트를 그대로 실행하면 같은 파일이 테스트 mock에 `@/lib/initial-admin-setup` 모듈을 등록하지 않아 로딩 실패한다. 이번 POS 변경과 무관하며 테스트 하네스는 수정하지 않았다.
- TypeScript `tsc --noEmit`: PASS. 변경 파일 ESLint: PASS. `npm run build`: PASS. 기존 menu-image-storage 동적 파일시스템 경고 2건은 출력됐으며 이번 변경과 무관하다.
- 실제 운영 NAS 배포, Caddy 활성 설정, 내부 split DNS, Chrome 로그인 및 주문/QR 실사용: TODO. 배포 전후 실제 HTTPS 주소에서 POS 인증과 기존 ADM/KDS를 확인해야 한다.
- DB, 환경변수/비밀키, Caddy 설정, Docker 이미지/컨테이너, NAS 운영 상태는 변경하지 않았다.

### 단계 상태

- POS 403 경로와 ADM/KDS 공통 HTTPS 비교: PASS
- 검증된 HTTPS ingress 기반 POS 접근 정책 수정: PASS
- 관련 회귀 테스트·TypeScript·변경 파일 ESLint·production build: PASS
- 운영 HTTPS 및 split DNS 브라우저 검증: TODO

복구 체크포인트: `checkpoints/20261102-pos-https-ingress.md`.

## 2026-11-02 — Device Agent와 TDKPOS 실행 분리

- `Program.cs`의 시작 시 POS Edge 자동 실행 등록을 제거했다. Device Agent의 루프백 바인딩, Origin/CORS 검사, 프린터·현금서랍·시스템 종료 API와 `/pos/exit` API는 유지했다.
- `/pos/exit`는 기존과 같은 `%LOCALAPPDATA%\\TDK-POS\\EdgeProfile` 및 현재 사용자 세션으로 한정해 POS Edge만 찾고 종료하도록 유지했다.
- `start-pos-kiosk.ps1`을 추가해 원격 HTTPS POS 주소를 별도 Edge 프로필과 kiosk fullscreen으로 실행하고 중복 실행을 막는다. 기존 POS 로그온 작업은 12초 지연 실행을 등록하도록 변경했다. 기존 로컬 Node/Chrome updater 파일은 보존했고 자동 시작에서는 분리했다.
- Device Agent 전용 로그온 작업 등록/해제 및 준비 확인 런처를 추가했다. Agent 실행 파일 경로는 설치 위치를 가정하지 않도록 등록 인자로 받는다.
- HTTPS POS Origin을 Device Agent 기본 및 POS 배포 allowlist에 정확히 추가했다. wildcard Origin이나 인증 완화는 없다.
- 검증: `dotnet build --no-restore` PASS(경고 0/오류 0), `ReceiptRenderChecks` PASS. Device Agent Windows 서비스 실행, 프린터·현금서랍 물리 출력, Edge kiosk, Windows 재로그온 및 예약 작업은 이 개발 환경에서 실제 수행하지 않아 미검증이다.
- 등록 절차: `tdk-device-agent/deploy/README-startup.md`, `tdk-pos/deploy/README.md`.

## 2026-11-02 — Device Agent 자동 실행 제거 Release 검증

- 프로젝트 전체 소스 검색 결과 `EnsureStarted()` 호출 및 Device Agent의 Edge 실행 인자는 없음. `msedge.exe` 참조는 전용 POS 프로필을 조회·종료하는 `PosEdgeManager`와 별도 POS 키오스크 런처에만 있다. Windows POS 로그온 작업은 별도 등록 스크립트로 유지된다.
- Release `win-x64` self-contained 빌드: PASS, 경고 0/오류 0. 신규 게시 폴더: `배포/TDK-POS_Printer/DeviceAgent-independent-20261102`.
- 새 게시 폴더의 기본 `appsettings.json`은 기존 POS 배포 설정과 비교해 프린터, 로깅, 허용 Origin 설정을 유지했고, 허용 목록에는 HTTPS POS Origin이 포함된다. 기존 `배포/TDK-POS_Printer/DeviceAgent` 폴더는 덮어쓰지 않았다.
- 게시된 EXE를 개발 PC에서 직접 실행해 `http://127.0.0.1:5168/` HTTP 200을 확인했다. 실행 전후 현재 세션의 Edge PID가 늘지 않아 Device Agent 실행으로 POS Edge가 뜨지 않음을 확인했고, 테스트 프로세스는 종료했다.
- Windows WMI 명령행 조회는 액세스 거부되어 대체로 현재 사용자 세션의 Edge PID 전후 비교를 사용했다. 프린터 실제 출력, 현금서랍, Windows 재로그온 및 스케줄러 등록은 미검증이다.

- 예약 작업 후속: 기존 POS 시작 작업이 현재 사용자에게 미등록이어서 `TDK Device Agent Auto Start`와 `TDK POS Auto Start`를 각각 등록했다. 읽기 전용 재확인에서 둘 다 현재 사용자 SID의 Interactive 로그온 작업이며, Agent는 새 게시 EXE를 사용하고 POS는 kiosk 런처를 12초 뒤 실행하도록 설정됐다. 등록만 했으며 로그오프/로그온 동작은 아직 확인하지 않았다.

## TDKPOS PWA 설치 지원

- 상태: IN_PROGRESS
- 현황: Next.js 16 `app/manifest.ts` 및 `/tdkpos/manifest.webmanifest` Route Handler를 재사용. POS 전용 192/512/180px 아이콘이 있고 Apple touch icon 메타데이터도 연결되어 있음. POS external path는 `proxy.ts` alias 처리; manifest 응답은 no-store. Service Worker/오프라인 캐싱 미사용.
- 수정 계획: 공통 manifest helper에서 POS의 short_name을 TDKPOS로 설정하고 POS maskable 아이콘을 추가. POS manifest route/metadata에서 앱 이름·외부 scope·Apple 아이콘 연결을 검증. 보안 및 POS API cache 정책은 그대로 유지.
- 검증 계획: manifest 단위 테스트, TypeScript, ESLint, production build, 외부 GET 확인 가능 여부 및 공개 자산 URL 확인. 실 Edge 설치는 실제 브라우저에서 검증 여부를 구분해 기록.

### 2026-11-02 PWA 구현·로컬 검증 결과

- POS 전용 manifest는 `TDKON POS` / `TDKPOS`, `start_url`·`scope` `/tdkpos`, standalone display, 테마 `#2563EB`로 제공한다. 기존 root manifest와 `/tdkpos/manifest.webmanifest` 별칭을 재사용했으며 Apple touch icon 메타데이터와 POS 로그인 흐름은 유지했다.
- 기존 192×192, 512×512, 180×180 POS 아이콘을 유지하고 512×512 maskable 아이콘을 추가했다. manifest에 선언된 아이콘 및 Apple 아이콘 모두 로컬 production 서버에서 HTTP 200, `image/png`로 응답했다.
- 로컬 production 서버에서 `/tdkpos/manifest.webmanifest`는 HTTP 200, `application/manifest+json`, `Cache-Control: no-store`를 반환했고 name, start_url, scope, display, 아이콘 경로가 요구사항과 일치했다.
- 경로 확인 중 alias rewrite 이후 내부 경로가 다시 canonical redirect되어 `/tdkpos/login`이 자기 자신으로 307되는 문제를 확인했다. `src/proxy.ts`와 `src/lib/host-access.ts`에서 surface marker를 권한 부여에 사용하지 않는 routing hint로만 판정해 해당 내부 rewrite에 한해 canonical redirect를 건너뛰도록 수정했다. POS HTTPS ingress, route 권한, API 인증 검사는 그대로 유지했다.
- 수정 후 local production HTTP 확인: `/tdkpos/login` HTTP 200, `/tdkpos`는 비로그인 상태에서 `/tdkpos/login`으로 정상 이동, POS session 경로는 비로그인 상태에서 `/tdkpos/login`으로 인증 redirect했다. 이전의 자기 자신 redirect는 재현되지 않았다.
- 검증: TypeScript PASS, 변경 파일 ESLint PASS, manifest·host access 단위 테스트 10/10 PASS, `npm run build` PASS. 빌드에서 기존 `menu-image-storage.ts` 동적 파일 경로 경고 2건이 출력됐다. 전체 lint 명령은 `.pos-runtime`의 브라우저 프로필 파일까지 탐색하여 완료되지 않아 변경 파일 대상으로 lint했다.
- Edge 설치 UI 및 실제 운영 도메인 검증은 미실시다. 외부 도메인 HTTP 요청은 이 개발 환경에서 연결 불가였고, 변경 사항은 운영 서버에 배포하지 않았다. 따라서 실제 Edge 설치와 독립 창 실행은 미검증이며, HTTPS 운영 도메인에 반영 후 Edge의 앱 설치 메뉴에서 확인해야 한다.
- DB, Docker, NAS, Caddy, POS 업무 로직 변경 없음. 기존 Docker 런타임 파일 복사 및 검증기 변경은 유지했다.
- 상태: 코드 구현 및 로컬 검증 PASS, 실제 Edge/운영 HTTPS 확인 TODO.

## 2026-11-02 — Device Agent / TDKPOS 자동 실행 및 금고 복구

- 상태: IN_PROGRESS
- 조사: 현재 `Program.cs`에는 `ApplicationStarted`/`EnsureStarted` 호출이 없고, `PosEdgeManager`는 전용 프로필의 Edge 종료만 한다. Device Agent의 `Process.Start`는 shutdown.exe와 taskkill.exe에 한정된다.
- 확인된 구형 시작 경로: `deploy/update-and-start-pos.ps1`가 Chrome으로 `http://localhost:3000/pos`를 열 수 있었고, 기존 POS 등록 스크립트는 같은 작업명만 교체하여 이름이 다른 구형/중복 작업을 정리하지 않았다. `start-pos-kiosk.ps1`은 전용 프로필의 이전 내부 URL 인스턴스를 HTTPS로 교체하지 않고 이미 실행 중으로 간주할 수 있었다.
- 작업 스케줄러 열람: 이 실행 환경의 `Get-ScheduledTask` 및 `schtasks /Query`가 CIM 경로 오류를 반환하여 POS PC에 등록된 실제 작업 목록을 확인하지 못했다. 배포 스크립트에서 작업 XML을 먼저 백업하고 POS 자동 실행 관련 작업을 하나의 `IgnoreNew` 작업으로 교체하도록 준비한다.
- 금고: `PrinterTest.OpenCashDrawer`의 SRP-350III DLE DC4 펄스와 Windows RAW `OpenPrinter`/`WritePrinter` 코드는 수정 전후 동일하다. 기본 `appsettings.json`의 프린터 이름이 POS 배포 설정과 달랐고, 이를 `BIXOLON SRP-350III`로 정정했다. 프린터 열거는 실행 환경 권한 오류로 확인되지 않아 실물 프린터 존재 및 금고 동작은 미검증이다.
- 진행 중: HTTPS-only Edge launcher의 낡은 전용 프로필 정리, 작업 백업/복구 및 단일 등록, 기존 설정을 보존하는 Release 적용 패키지 생성.
- 검증 계획: PowerShell AST 구문 검사, Release build/publish, `ReceiptRenderChecks`, JSON/Origin 검증, 배포 실행 파일로 Agent를 시작해 5168 응답 및 Edge 미실행 확인. 실물 영수증/금고와 POS PC의 실제 작업 교체는 해당 PC/프린터가 없어 미검증으로 구분한다.
### 2026-11-02 — Agent/POS 수정 및 Release 배포 결과

- 수정: 기본 Agent `appsettings.json`의 프린터 이름을 `BIXOLON SRP-350III`로 정정했다. 기존 네 개 Origin 항목은 보존했다. POS용 배포 설정도 같은 모델명과 HTTPS Origin을 가진다.
- POS 실행: `start-pos-kiosk.ps1`은 전용 Edge 프로필만 조회한다. 실행 중 프로필이 이미 HTTPS kiosk 설정이면 중복 실행하지 않고, 오래된 URL/비-kiosk 구성이라면 그 전용 프로필 프로세스만 종료한 뒤 HTTPS kiosk로 교체한다. 일반 Edge 프로세스는 건드리지 않는다.
- 구형 경로: `update-and-start-pos.ps1`의 Chrome `--app=http://localhost:3000/pos` 실행 코드를 제거하고 POS Edge kiosk launcher를 호출하도록 변경했다. Device Agent의 `Program.cs` 시작 시 Edge 호출은 이미 제거된 상태임을 확인했다. `EnsureStarted` 런타임 호출은 없고 `/pos/exit` 전용 프로필 종료 동작은 유지한다.
- 작업 스케줄러: 등록 스크립트는 TDK POS 자동 실행 후보들의 XML 백업 후 구형/중복 작업을 제거하고 `TDK POS Auto Start` 하나를 현재 사용자 로그온, `IgnoreNew`, 12초 지연, HTTPS 전용 launcher로 등록한다. XML 복구 스크립트와 사용자용 적용 스크립트를 추가했다.
- Release `win-x64` build: PASS, 경고 0 / 오류 0. `ReceiptRenderChecks`: PASS. Self-contained `dotnet publish`: PASS.
- 배포 폴더: `배포/TDK-POS_Printer/DeviceAgent-repair-20261102`. EXE, 정정된 기본 설정, POS kiosk/task 교체 스크립트, 설정 보존형 적용 스크립트 및 복구 안내를 포함한다.
- 최신 publish 실행 시험: 현재 5168 포트는 기존 프로세스가 점유해 종료하지 않았다. 대신 별도 5169 테스트 포트의 개발 모드로 새 publish Agent를 직접 시작해 `/` HTTP 200을 확인했다. 실행 전후 새 Edge 프로세스 0개였고 시험 Agent는 종료했다.
- 미검증: 작업 스케줄러 조회가 이 환경에서 CIM 오류를 반환해 POS PC에 현재 몇 개의 작업이 등록됐는지 직접 확인하거나 실제 교체할 수 없었다. 프린터 열거도 권한 거부로 막혀 영수증 실출력 및 금고 개방은 검증하지 않았다. ADM/KDS 실기기 회귀도 수행하지 않았다.
- 상태: 코드·빌드·publish·Agent 분리 검증 PASS. POS PC의 작업 교체와 실물 프린터/금고 확인은 TODO.
### 2026-11-02 final Device Agent/POS package audit
- PowerShell parser validation: PASS for repair, POS launcher, task registration, task restore, and legacy updater scripts.
- Repair package scripts were compared with source copies; hashes match. The package contains no test build artifacts.
- Static source audit: no Device Agent startup callback or EnsureStarted reference remains. The only Agent Edge references inspect/stop the dedicated profile for `/pos/exit`; `Program.cs` Process.Start is the Windows shutdown path.
- POS launcher is HTTPS-only (`https://tdkon.myasustor.com/tdkpos`), identifies only the dedicated Edge profile, replaces stale instances in that profile, and the task uses IgnoreNew.
- Actual POS PC scheduled-task inventory/replacement and physical receipt/cash-drawer checks remain TODO because this environment could not query the target PC task scheduler or printer. Do not mark deployment/hardware validation PASS until checked on that PC.

## 2026-11-02 TDKPOS PWA identity isolation

- Root cause confirmed from rendered local server HTML: `/tdkpos` redirected to `/tdkpos/login`, whose `<link rel="manifest">` originally pointed to `/manifest.webmanifest`. The POS alias rewrites to the shared `/login` route, and neither that route nor the POS layout declared a manifest; root metadata therefore depended on the external-surface request header. On the public host, the root manifest defaults to ADM, so Edge could install TDKADM from the POS login page.
- Added one shared POS metadata object and attached it to the POS `/login` route layout and `/pos` application layout. Both now explicitly publish `/tdkpos/manifest.webmanifest` and POS-specific app names/icons. Root metadata, ADM layout, ADM manifest route, proxy rules, auth, and Device Agent were not changed.
- Live local HTTP verification after hot reload: `/tdkpos` and `/tdkpos/login` render `rel="manifest" href="/tdkpos/manifest.webmanifest"`; `/tdkadm` retains its prior root manifest link. POS manifest returns HTTP 200, application/manifest+json, TDKON POS / TDKPOS, id/start_url/scope `/tdkpos`, and POS icons. ADM manifest endpoint returns HTTP 200 with TDKON ADM, id/start_url/scope `/tdkadm`, and ADM icons. POS and ADM identities are distinct. All referenced icon HEAD requests returned HTTP 200 image/png.
- Validation in a sanitized temporary source copy: production build PASS (existing unrelated menu-image-storage tracing warnings); TypeScript PASS; changed-file ESLint PASS; app-manifest tests 4/4 PASS. Full repository ESLint remains FAIL from 33 pre-existing errors and 5 warnings in unrelated files; none are in the files changed for this task.
- Public HTTPS host could not be reached from this environment, and Edge installation UI was not exercised. Local rendered HTML and both app manifest routes were verified against the running development server.

## 2026-11-02 TDKKDS Android PWA fullscreen

- Confirmed the KDS page renders `rel="manifest" href="/tdkkds/kds.webmanifest"`. The active manifest is the route handler at `src/app/tdkkds/kds.webmanifest/route.ts`; the older `public/kds.webmanifest` is not linked by the KDS page and remains untouched.
- Added a KDS-only display-options helper and applied `display: fullscreen`, `display_override: [fullscreen, standalone]`, and `orientation: landscape` to the active KDS response. Existing KDS name, id, start URL, scope, colors, and icons remain unchanged. POS and ADM manifest endpoints still return standalone, their own IDs/scopes/icons, and were not modified.
- Verified live local HTML and manifest responses: KDS HTML points to the KDS route; KDS, POS, and ADM manifests returned HTTP 200 with distinct identities; KDS icons returned HTTP 200 image/png. No Service Worker or Workbox registration was found in `src`, `public`, package.json, or Next config. The KDS response retains `Cache-Control: no-store`.
- Validation: TypeScript and production build PASS in an isolated source copy; changed-file ESLint PASS; manifest tests 5/5 PASS. Build reports two pre-existing menu-image-storage tracing warnings.
- Android device/UI validation is TODO. Manifest requests fullscreen and landscape, but Android status and navigation bars remain browser/device controlled. Recommend uninstalling the existing KDS PWA and reinstalling from `https://tdkon.myasustor.com/tdkkds` for deterministic adoption of the display/orientation change; Chrome may update installed manifests later, but rollout timing is browser-managed.

## 2026-11-02 TDKPOS receipt / Device Agent diagnosis

- Traced checkout completion to receipt setting lookup, `/api/sales`, and Device Agent `/api/printer/document` (legacy `/api/printer/receipt` fallback); account-transfer payments additionally call `/api/account-transfer-notice` before local printing.
- Code-level 403 source found for account-transfer notice: `/api/account-transfer-notice` was absent from `isExternalPosPath`, so the public-host proxy returned plain-text `Forbidden` before the existing authenticated route ran. The client called `response.json()` unconditionally, producing the reported JSON parse error. Added this endpoint to the existing verified POS ingress policy; the route's employee/session checks remain unchanged. A live production Network capture was unavailable, so the exact failed request from the physical POS is not independently confirmed; if this was a non-transfer payment, use the improved error details to identify its endpoint.
- POS response handling now reports endpoint, stage, HTTP status, and a bounded response body for non-JSON failures in checkout, receipt preparation, transfer-notice preparation, auto-print settings, and local Device Agent printing. No credentials or token values are logged. Device Agent request origin policy, CORS, localhost binding, printer configuration, raw output, cash drawer API, and POS Edge lifecycle were not changed.
- Changed files: `src/lib/host-access.ts`, `src/lib/host-access.test.mjs`, `src/lib/api-response.ts`, `src/lib/api-response.test.mjs`, `src/lib/receipt-print.ts`, `src/lib/account-transfer-notice.ts`, `src/lib/device-printer.ts`, `src/app/pos/PaymentModal.tsx`.
- Validation in a sanitized temporary source copy: TypeScript PASS; changed library ESLint PASS; endpoint/response tests 10/10 PASS; production build PASS. Build continues to emit two existing menu-image-storage tracing warnings. PaymentModal ESLint reports an existing unrelated `Date.now()` render purity finding at line 427; this work did not alter that line. The repository's direct `tsc` run was also affected by stale `.next/dev/types`; clean-copy TypeScript and Next production build passed.
- Hardware / runtime validation TODO: this environment cannot access the actual POS PC's localhost Device Agent, installed `appsettings.json`, BIXOLON SRP-350III, cash drawer, public NAS server, or Chrome Network panel. No Device Agent Release publish was performed because no Agent-side defect was confirmed and changing its deployment package would not address the code-proven proxy route omission. Deploy the POS app change, then verify a normal payment, account-transfer notice, local Agent HTTP status/body, paper output, and cash-drawer operation on the POS PC. If a non-transfer receipt still fails, capture the diagnostic endpoint/status/body to distinguish app proxy, ingress, local Agent Origin, and printer-stage failure.

## 2026-11-02 TDKPOS payment CashBox control

- Added a transparent text-only `CashBox` touch target above “총 결제금액” in the payment center column. It has no fill, border, or shadow, uses a 44px minimum hit height, and remains enabled independently of payment busy/completed state. An in-flight ref blocks rapid duplicate requests; failures display beside the control without changing payment state.
- Reused the existing `/cash-drawer/open` API through `openCashDrawer()`; no Device Agent endpoint or cash command was changed. The shared helper now distinguishes localhost Agent connection/CORS failure, 5-second timeout, and HTTP/command errors, safely reading the Agent's JSON error or a bounded non-JSON response.
- Changed files: `src/app/pos/PaymentModal.tsx`, `src/lib/cash-drawer.ts`.
- Validation in the sanitized temporary source copy: TypeScript PASS; cash drawer response tests 4/4 PASS; targeted ESLint PASS (the unrelated existing PaymentModal `Date.now()` render-purity rule was disabled for that file during this scoped lint); production build PASS with two existing menu-image-storage tracing warnings.
- Not verified on a physical POS touchscreen or BIXOLON SRP-350III/cash drawer. The actual API command/hardware response and touch usability still require on-site confirmation. The existing Dev Agent project was not modified.

## 2026-11-02 CashBox alignment adjustment

- Applied `-translate-y-2` to the CashBox control only. This moves the label and its unchanged 44px+ hit target upward by 8px while leaving the control's layout slot, total-payment title/amount, and the rest of the three-column layout in place.
- TypeScript and focused ESLint passed in the sanitized validation copy. The red-line screenshot was not available in this message context, so pixel-level alignment against that reference and PC/tablet visual confirmation remain unverified.

## 2026-11-02 POS customer selector balance switch

- Added a second right-panel switch below 거래관리 using the same 52px row height and 76×40px ON/OFF control; the two controls are separated by 6px. The balance switch is disabled when 거래관리 is OFF, and switching 거래관리 OFF resets balance display to OFF.
- When balance is ON, customer rows show formatted trade balance in place of phone number; when OFF, existing phone display and selection behavior are retained. The user clarified that POS scope is balance display plus normal customer selection, so no ADM-only ledger management UI was exposed in POS.
- Adding the switch reduces the logo's flexible spacer, moving the centered logo downward without changing its size/color or the right panel's outer layout. Recent/name/phone/sort controls and left customer list were not changed.
- TypeScript and focused ESLint passed in the sanitized validation copy. No screenshot was supplied in this turn and no authenticated browser screenshot was available; exact visual screenshot confirmation and PC/tablet appearance remain unverified.

## 2026-11-02 POS customer balance ledger dialog

- CustomerSelectDialog의 기존 거래관리/잔액 스위치 상태를 그대로 사용한다. 거래관리 ON + 잔액 ON일 때 고객 행을 누르면 POS 잔액 창이 열리고, 잔액 OFF에서는 기존 고객 선택 콜백을 유지한다. 스위치 디자인과 위치는 변경하지 않았다.
- Added a read-only POS ledger dialog with the ADM title “거래관리”, date presets (전체/최근 90일/최근 30일/당월), print action, transaction list, and current balance. It uses the existing ledger GET API response and server-calculated running balances; POS does not calculate or mutate ledger values.
- Transaction rows open the existing ADM CustomerTradeDetailModal. The ledger and detail GET endpoints now permit authenticated POS sessions as well as existing ADM sessions. Ledger POST remains behind requireAdminAccess and the ADM member check; no POS write access was added.
- Added print layout styles for the POS dialog. No database or business data was changed.
- Targeted ESLint: PASS. TypeScript: PASS in the isolated validation copy. The repository-root `tsc --noEmit` remains blocked by stale mixed `.next/dev/types` and production route types (`/login` is rejected by the generated `LayoutRoutes` type); no application source change was made for that generated-artifact conflict. Production build and authenticated browser/print verification were not run. Visual and runtime checks remain pending.

## 2026-11-02 POS customer balance toolbar alignment

- Moved the existing print button after the four date presets, with an 84px spacer (reduced to 48px on narrow viewports), and moved the existing current-balance summary to the toolbar's far right. Kept amount formatting and type size/weight/color unchanged; removed its former bottom placement.
- The toolbar remains a single non-wrapping row; narrow layouts can scroll horizontally rather than overlap. Table markup, date filtering, print action, and balance calculation were not changed.
- CustomerBalanceDialog targeted ESLint: PASS. TypeScript in the isolated validation copy: PASS. Actual Chrome screenshot/print preview was not available in this environment, so visual confirmation remains TODO.

## 2026-11-02 POS customer balance ledger printer output

- Replaced browser `window.print()` with the existing `sendPrintDocument()` path to Device Agent `/api/printer/document`. The request contains only per-transaction row commands and the required final cut command; it does not call the cash-drawer API or the legacy receipt endpoint. Printer settings, CORS/origin checks, and Device Agent source/config remain unchanged.
- Added a printer-width-aware document builder using the Device Agent's 504px raster width with 8px margins on each side (488px printable width), 12px Malgun Gothic canvas measurement, dynamically allocated fixed date/amount/balance columns, and grapheme-safe `..` clipping for descriptions. Printing uses exactly the current visible entry array and preserves its order; large ledgers are sent sequentially in batches under the Agent's 250-command limit.
- Output errors are surfaced by category: Device Agent connection, Agent/printer response, request, and document-generation errors. No transaction or balance data is changed.
- Targeted ESLint: PASS; isolated TypeScript check: PASS; customer-balance printer unit tests: 5/5 PASS; existing cash-drawer tests: 4/4 PASS; isolated Next production build: PASS (two existing menu-image-storage tracing warnings). Existing Device Agent Windows GDI renderer accepted and rasterized a Korean/long-description/wide-amount sample document at 504px; the sample rendered exactly three transaction rows on three text lines, and the existing receipt render cases passed.
- Actual BIXOLON SRP-350III physical printing and Agent response on the POS PC remain unverified. The sample width estimate passed the existing Windows GDI raster renderer without wrapping; the production browser canvas measurement and the real printer still need on-site confirmation before marking hardware output PASS.

## 2026-11-02 POS customer balance ledger print format finalization

- Updated the ledger printer layout to the standard receipt body size (24px Malgun Gothic) and the Device Agent's 488px printable width. Standard receipt store header/logo and customer-title position are reused through `buildCustomerLedgerHeader`; the customer name replaces the ordinary receipt title. A POS-session-protected read-only route supplies the existing store information and receipt logo. No DB or Agent changes were made.
- The visible period-filtered rows are printed in their existing order. Date is `YY/MM/DD`; amount and running balance use comma formatting, outflows/negative balances keep `-`, and each transaction is exactly one 24px row. The description column takes the remaining width and clips on grapheme boundaries with `..`. The last receipt section shows the current full-history balance in bold, then a separator and cut. It is not recalculated from filtered rows.
- Initial Windows GDI raster inspection showed the final date digit wrapping with the browser canvas width estimate. Increased only the reserved date column margin, regenerated the fixture and re-rendered it; all three sample ledger entries now occupy one raster line each at the standard font size, including `-9,999,999` and `9,999,999`. Long Korean and mixed English descriptions clip without wrapping.
- Verification: targeted ESLint PASS; TypeScript PASS after the production build regenerated route types (the earlier root tsc invocation hit stale mixed `.next/dev/types`); customer-ledger print tests 5/5 PASS; Next production build PASS with two existing `menu-image-storage.ts` tracing warnings; Device Agent GDI document-render validation PASS. No physical BIXOLON SRP-350III or POS browser/Agent was available, so actual paper output and on-device canvas/GDI equivalence remain unverified.
- No authentication, receipt-sale, cash drawer, balance calculation, transaction data, Device Agent, or database schema logic was changed. Status: code and local render validation PASS; physical printer validation TODO.

## 2026-11-02 POS customer ledger receipt two-line format

- Changed each filtered ledger transaction to exactly two 24px body rows: `YY/MM/DD  내용`, then a date-width indent followed by right-aligned signed amount and transaction balance. Description uses the full first-line remainder and is clipped with `..` only when required. Input order and ADM-calculated running balances are preserved.
- The standard receipt-style header now includes the selected customer name in the receipt-title position and the chosen period label (전체/최근 90일/최근 30일/당월). The final section is separator → bold actual current balance → one feed line → existing Device Agent cut command. Device Agent's `BuildDocumentCommand` adds no extra feed for cut, so no duplicate/extra feed was introduced.
- Verification: TypeScript PASS, targeted ESLint PASS, ledger print unit tests 5/5 PASS, Production Build PASS (two pre-existing menu-image-storage tracing warnings), Windows Device Agent GDI document renderer PASS. GDI sample includes Korean and mixed English descriptions, deposits, withdrawals, maximum-format values, negative balance, selected period, and final balance/feed/cut sequence. No physical printer or live POS session was available; paper output and actual Device Agent hardware response remain TODO.
- No DB, balance calculation, ADM transaction data, regular receipt printing, cash drawer, or Agent security/API changes. Status: implementation and local rendering PASS; physical printer validation TODO.

## 2026-11-02 POS customer ledger receipt truncation and cut-position follow-up

- Root cause confirmed in document batching: the Agent limit is 250 commands; the final document fits 119 two-line trades plus header/footer, while a no-footer document fits 121 trades. The previous loop always consumed 121 when the remainder was just above 119. At 120 trades it sent all trades on a cut document, then emitted a separate header/footer-only document; at other boundary counts it could similarly separate the ending trade from the balance or create a nearly empty extra slip. The transaction commands were generated, but the final balance was detached from the ledger and could appear absent to the operator.
- Fixed batching to calculate the minimum document count and balance batches while preserving each transaction's two commands together. The final document always contains the last trade's two rows, current-balance row, two feed lines, and final cut. Added boundary tests for 119/120/121/240/241/242 transactions and exact row counts.
- Confirmed no async cut race: POS awaits each `sendPrintDocument`; Device Agent validates one final cut, constructs raster and cut bytes in order, checks `WritePrinter` wrote the full buffer, and only then returns the request response. Agent cut command adds no feed of its own. The customer-ledger footer now emits `feed(2)` immediately before the existing cut; regular receipts and Agent code remain unchanged.
- Verification: TypeScript PASS, targeted ESLint PASS, customer ledger tests 6/6 PASS, Next production build PASS (two existing `menu-image-storage.ts` tracing warnings), Device Agent GDI render PASS with final balance + two feed lines + final cut. Actual ledger row count at the POS and physical BIXOLON paper result were not available in this environment; hardware output remains TODO.
- No database, trade data, balance calculation, general receipt, account-transfer notice, cash drawer, Device Agent, or authentication changes.

## 2026-11-02 POS customer ledger print Agent-free revision

- Per the follow-up requirement, removed the new Agent batch route and batch RAW builder. `Program.cs` retains only the unrelated pre-existing POS auto-start removal; `PosPrintDocument.cs` and its render test are restored to their pre-batch contents. No receipt, cash drawer, printer configuration, or Origin code was changed for ledger printing.
- The ledger is now sent by TDKON as one `PrintDocument` to the existing `/api/printer/document` API through `sendPrintDocument()`. The document contains all visible transactions, current balance, `feed(2)`, and one final cut. POS checks displayed and generated transaction counts and verifies that sequence before making the request.
- Existing Agent contract: `/api/printer/document` accepts one document with at most 250 commands, and validation requires exactly one cut at the final command. With the current 7 header and 4 footer commands and two commands per trade, a single request supports at most 119 transactions. Larger ledgers are rejected before printing rather than split into multiple jobs.
- Local development-machine Agent probe: `GET /` returned HTTP 200; `OPTIONS /api/printer/document` returned 204 with the configured public Origin, POST/Content-Type and Private Network headers; `OPTIONS /api/printer/document/batch` returned 404; an intentionally invalid empty POST to the existing document endpoint returned 400 validation JSON without creating a print job. This confirms that the Agent currently running on this development machine does not have the batch route. The actual POS PC Agent was not inspected.
- Validation after this revision: TypeScript PASS; targeted ESLint PASS; customer ledger tests 6/6 PASS; Next production build PASS with two existing `menu-image-storage.ts` tracing warnings; Agent Release build from restored source PASS (0 warnings/errors). The generated Agent DLL was not retained or deployed. Actual Chrome-to-POS-Agent printing and BIXOLON paper output remain unverified. Deploy the TDKON update only; no Agent update is required for this structure.

## 2026-11-02 KDS 찌개 첨가 그룹 표시

- ADM 메뉴 편집은 `찌개 첨가`를 `ADDON`으로 저장하고 메뉴 API/페이지는 `kds_kind`, `kds_group_key`를 읽고 쓰는 것을 소스에서 확인했다. KDS는 `materializeOrder()`에서 그 값을 주문 작업 스냅샷으로 저장하며 `INSERT IGNORE`로 이미 만들어진 작업을 다시 구성하지 않는다. 따라서 분류 변경 전 생성된 대기 주문은 예전 독립 작업으로 남을 수 있었다. 개발 DB 연결은 읽기 전용 확인 시 `EACCES`로 거부되어 특정 메뉴의 실제 저장값은 검증하지 못했다.
- KDS 응답에 현재 메뉴의 분류와 그룹키를 포함하고, 기존 스냅샷이 SOLO인 ADDON 작업은 동일 세션·동일 주문·동일 조리 그룹 및 일치하는 조리 상태를 가진 찌개 작업 하나가 명확할 때만 화면/동작 행에서 함께 묶도록 했다. 이 경우 행의 기존 상태 버튼이 두 작업 ID를 함께 처리한다. 불명확하거나 조리 상태가 다르면 독립 작업으로 남겨 누락을 방지한다.
- 새 작업 구성에서 그룹키가 있는 ADDON은 정확히 같은 POT 그룹에 연결한다. 그룹키가 비어 있으면 기본 POT 그룹, 또는 유일한 찌개 그룹에만 연결한다. 여러 그룹 중 어느 것인지 불명확하면 첨가를 독립 작업으로 유지한다. 메뉴명 문자열로 분류하지 않는다.
- 가로 상세 표시의 구분자를 쉼표에서 공백으로 바꿔 `꽁치김치찌개 흑돼지추가 두부추가`처럼 같은 두 번째 줄에 이어 붙인다. 별도 카드 디자인과 조리 상태 제어 규칙은 유지했다. 표시 박스 그룹 기준에 주문 ID도 추가해 같은 테이블의 서로 다른 주문을 합치지 않는다.
- 검증: KDS 모델/그룹핑 테스트 69/69 PASS, `tsc --noEmit` PASS, 수정 파일 ESLint 오류 0 (기존 경고 2건), `npm run build` PASS (기존 `menu-image-storage.ts` 동적 파일 접근 경고 2건). 실제 개발 DB 질의와 Chrome/KDS 실기기 화면 검증은 접근 권한 및 실행 서버 부재로 미수행이며 PASS로 표시하지 않는다. DB 및 주문 데이터 변경은 없다.
- 그룹으로 표시되는 분류 변경 전 첨가 작업은 테이블 시작·선택 냄비 완료 API도 같은 주문 ID, POT 그룹키, 현재 `ADDON` 분류, 조리상태를 서버에서 재검증하며 해당 task ID들을 일괄 처리한다. 기존 3초 시작 취소는 서버의 동일 batch ID/task ID 경로를 유지한다.
- Project-wide ESLint excluding `.pos-runtime/**` was attempted and exits with pre-existing errors in unrelated migration scripts, admin/customer screens, POS files, and existing test files (33 errors / 5 warnings). ESLint on the changed KDS files exits 0 with two pre-existing warnings; no new changed-file errors were reported.
## 2026-11-03 TDKHOS 1차 개발 계획 및 선행 조사

### 목표

- `/tdkhos` 직원용 모바일 HOS를 공통 직원 인증과 HOS 권한 검사에 연결한다.
- 기존 테이블 배치, 주문 세션, 메뉴·옵션 가격 검증, 주문 취소 트랜잭션을 재사용한다.
- POS/ADM/KDS와 Device Agent 업무 기능을 변경하지 않고, QR 대기 주문은 실제 승인 API가 있는 경우에만 연동한다.

### 현재 조사 결과

- HOS 전용 화면 경로는 아직 없다. `src/proxy.ts` 및 `src/lib/host-access.ts`의 외부 별칭은 POS/ADM/KDS만 매핑한다.
- `src/lib/program-trust.ts`에는 HOS 권한 열, 토큰 프로그램 식별자, `tdk_hos_trust` 쿠키가 정의되어 있다. `trustStatus()`는 HOS 직원/접근 권한 조회 분기가 없고, PIN 로그인과 임시 비밀번호 API는 HOS를 명시적으로 거부한다.
- `staff_sessions.session_type` 스키마 ENUM은 `POS`, `ADMIN`, `KDS`만 허용한다. HOS 세션을 정확히 격리하려면 DB ENUM 변경 마이그레이션이 필요하며, 본 작업에서 DB에 적용하지 않는다.
- POS 테이블/주문 API는 기존 세션 및 트랜잭션 검증을 제공하지만 POS 전용 세션 가드를 사용한다. HOS에 필요한 API만 HOS 세션을 허용하도록 범위를 한정해야 한다.
- POS 화면은 `qr_orders`를 조회하지만 프로젝트에서 고객 QR 주문 접수/승인/거절 API는 확인되지 않았다. QR 데이터를 운영 중 주문처럼 표시하거나 자체 승인 로직을 만들지 않는다.
- HOS 권한은 직원관리 API가 `hos_enabled` 컬럼 존재를 동적으로 확인한다. DB 컬럼이 없는 배포에서는 HOS 로그인을 허용할 수 없다.

### 단계 및 상태

1. 기존 HOS 권한·인증·테이블/주문/취소·QR 경로 조사 — IN_PROGRESS
2. HOS 전용 안전 세션과 공통 로그인 화면 연결; 필요한 session_type ENUM 마이그레이션 SQL은 별도 작성, DB 적용 금지 — TODO
3. 모바일 테이블 배치·세션 미수금·주문 상세 조회 API 및 화면 — TODO
4. POS 트랜잭션 검증을 재사용하는 HOS 추가 주문 staging/단일 전송 — TODO
5. 기존 주문 취소 API의 부분 수량 취소 준비 및 단일 전송 — TODO
6. QR API 존재 재조사 및 미구현 상태/통합 지점 문서화 — TODO
7. 타입 검사, ESLint, 관련 테스트, production build, 회귀 확인 — TODO

### 안전 조건

- 운영 DB 접근/수정, 마이그레이션 실행, 직원 인증정보/권한 변경, Device Agent 수정은 하지 않는다.
- 개발 DB 연결/실제 브라우저 검증은 별도 가능 여부를 확인하고, 수행하지 못한 항목은 PASS로 기록하지 않는다.
- HOS API는 매 요청에서 HOS 전용 세션, 직원 활성/미퇴사 상태, `hos_enabled` 및 신뢰 토큰을 확인한다.
- 기존 POS API의 인증 범위를 전체적으로 넓히지 않는다. 필요한 주문/취소 진입점만 명시적으로 HOS 세션을 추가 허용한다.
- 완성 가능한 코드 변경과 검증을 진행한 뒤, DB ENUM 마이그레이션이 실제 실행을 막는 경우 배포 전 선행 작업으로 명확히 기록한다.
## 2026-11-03 TDKHOS 1차 구현 결과

### 구현

- 공통 `ProgramTrustGate`에 HOS ID 상태 조회, 마스터 비밀번호 등록/인증, HOS 신뢰 토큰, 개인 PIN 절차를 연결했다.
- `/tdkhos` 모바일 로그인 및 테이블 화면을 추가했다. 테이블/주문 자료는 기존 POS 테이블 세션·주문·메뉴 카탈로그를 사용하며 별도 HOS 주문 테이블은 만들지 않았다.
- HOS 전용 API에서 직원 활성·퇴사 상태, `hos_enabled`, HOS 신뢰 토큰 및 HOS 세션을 확인한다. 직원 세션 유형에 HOS를 추가하는 TEST/운영용 SQL을 작성했지만 어느 DB에도 적용하지 않았다.
- 주문 추가는 기존 테이블 세션 및 주문 API를 통해 전송하고, 취소는 기존 배치 취소 API를 사용한다. 전체 주문 취소에는 현재 HOS 직원의 PIN 재확인을 적용했다.
- 기존 QR 대기 주문 API 또는 승인 흐름을 확인하지 못해 QR 주문을 임의로 표시하거나 승인하지 않는다. 화면은 QR 미연동 상태를 명시한다.
- HOS를 HTTPS ingress 및 외부 경로 별칭에 추가했다. Device Agent, POS/ADM/KDS 업무 동작은 의도적으로 변경하지 않았다.

### 변경 파일

- 신규: `src/app/hos/**`, `src/app/api/hos/**`, `src/lib/hos-auth.ts`
- 공통 인증/세션/접근 제어 연결: `src/db/schema.ts`, `src/lib/program-trust-routes.ts`, `src/app/api/admin-center/trust/initial-master/status/route.ts`, `src/app/api/program-trust/master-recovery/register-initial/route.ts`, `src/app/api/program-trust/pin/route.ts`, `src/components/ProgramTrustGate.tsx`
- 기존 주문 API의 HOS 세션 허용: `src/app/api/table-sessions/route.ts`, `src/app/api/table-sessions/[sessionId]/orders/route.ts`, `src/app/api/order-items/cancellations/batch/route.ts`
- 경로 및 ingress: `src/lib/host-access.ts`, `src/proxy.ts`, `src/app/layout.tsx`
- 테스트: `src/lib/host-access.test.mjs`
- 별도 DB 변경 스크립트: `db-migrations/20261103_hos_staff_sessions_test.sql`, `db-migrations/20261103_hos_staff_sessions_production.sql`

### 검증 및 제한

- TypeScript: PASS (`npx tsc --noEmit --pretty false`)
- 변경 파일 ESLint: PASS (오류/경고 없음)
- Host 접근 테스트: PASS 7/7
- Next.js production build: PASS. 기존 `src/lib/menu-image-storage.ts` 동적 파일 접근 관련 경고 2건은 남아 있다.
- 소스 복구 체크포인트: `checkpoints/20261103-tdkhos-v1-source.zip`
- 실제 DB 연결, migration 실행, Chrome/태블릿 로그인과 주문 전송, 실물 QR 흐름은 검증하지 않았다. TEST/운영 DB와 직원·주문 데이터는 변경하지 않았다. HOS 세션 ENUM migration은 배포 전 대상 스키마를 확인한 뒤 TEST DB에서 먼저 검증해야 한다.

## 2026-11-03 TDKHOS 2차 개발 DB Migration 및 통합 검증 결과

### 개발 DB 구조 및 Migration

- `.env.local`의 대상은 `TDK_POS_TEST`였고 실제 연결 후 `SELECT DATABASE()`도 `TDK_POS_TEST`를 반환했다. 서버는 MariaDB 10.11.18, 테이블은 InnoDB다. 운영 DB에는 접속하지 않았다.
- `staff_sessions.session_type`은 이미 `ENUM('POS','ADMIN','KDS','HOS')`였다. 이에 `20261103_hos_staff_sessions_test.sql`의 ALTER는 실행하지 않았다. 현재 세션 186행 및 POS/ADM/KDS 세션 분포를 확인했다.
- HOS 로그인에 필요한 `staff.hos_enabled`는 개발 DB에 없었다. 기존 `staff_common_pin_hos_test.sql`의 HOS 컬럼 추가를 검토하고 사전 구조/행 수 복구 지점을 `.codex-backups/20261103-hos2-devdb-preflight.json`에 기록했다. 적용 시도는 `ER_TABLEACCESS_DENIED_ERROR`로 거부되었다. 권한 조회에서 계정에는 `TDK_POS_TEST`의 ALTER 권한이 없었으므로 우회하지 않고 중단했다.
- 적용 전후 재확인: `staff.hos_enabled` 없음, `staff` 2행, `staff_sessions` 186행, `session_type` ENUM 정의 동일. DB 데이터나 스키마 변경은 완료되지 않았다. `hos_enabled` 누락 때문에 개발 DB에서 HOS 권한 직원 수/마스터 비밀번호·PIN 준비 상태를 판정할 수 없다.

### 화면 및 API 점검

- 임시 로컬 개발 서버에서 `/tdkhos`, `/tdkpos`, `/tdkadm`, `/tdkkds` 페이지 요청은 HTTP 200이었다.
- HOS 세션 쿠키 없는 요청은 `/api/hos/tables`, `/api/hos/menu-catalog`, `/api/hos/tables/1`에서 각각 HTTP 401을 반환했다. `/api/hos/auth/trust`의 로그인 전 상태 요청은 HTTP 200이었다.
- 실제 직원 마스터 비밀번호/PIN 로그인, HOS 허용/거부 직원 분기, HOS 세션 발급·로그아웃은 검증하지 않았다. 권한 컬럼과 DB ALTER 권한이 없고, 실제 인증정보를 대신 입력하지 않았다.
- 테이블 배치/금액, 추가 주문·KDS 반영, 취소·부분 수량, 취소 해제, 중복 전송, 실패 후 초안 보존은 실제 DB 주문을 쓰지 않아 미검증이다. POS·ADM·KDS 회귀는 페이지 응답만 확인했고 실제 로그인/업무 API 회귀는 미검증이다.
- QR 참조를 재조사했다. POS 화면은 `qr_orders`와 `qr_sessions`를 조인해 기존 QR 주문 표식/언어를 표시하고, 관리 결제 정리 코드가 연결된 주문 ID를 초기화한다. 고객 주문 API로 검색된 `/api/customers/order`는 고객 정렬용 PATCH다. QR 주문 접수·승인·거절 서버 API는 찾지 못해 HOS에는 연동하지 않았다.

### 코드 검사

- TypeScript: PASS (`npx tsc --noEmit --pretty false`)
- HOS 및 관련 인증/세션/API 파일 ESLint: PASS (오류/경고 없음)
- 테이블 금액/세션/접근 관련 테스트: PASS 17/17
- Next.js production build: PASS. 기존 `menu-image-storage.ts` 동적 파일 접근 경고 2건은 유지됨.
- 주문 추가·취소 API 통합 테스트 및 실제 모바일/Chrome/태블릿 검증: 미수행. 권한 migration이 막혀 안전한 인증 세션으로 검증할 수 없었다.

### 다음 절차

1. DB 관리자가 승인된 경로로 `TDK_POS_TEST.staff`에 `hos_enabled TINYINT NOT NULL DEFAULT 0`를 추가한다. 기존 직원 권한은 자동으로 켜지지 않도록 유지한다.
2. 개발 DB에서 컬럼 정의와 기존 직원 권한 기본값을 읽기 전용으로 검증한 뒤, 격리된 HOS 테스트 직원/테이블로 인증 및 주문·취소 통합 검증을 진행한다.
3. POS·KDS 영향 및 TEST 회귀 결과를 확인한다. 운영 DB/NAS migration 또는 배포는 별도 승인·작업으로 남긴다.

- DB 사전 복구 지점: `.codex-backups/20261103-hos2-devdb-preflight.json` (DDL/행 수만 포함; 인증 해시·직원 ID 없음)
- 구현 소스 체크포인트: `checkpoints/20261103-tdkhos-v1-source.zip`
- 결론: 개발 DB의 HOS 세션 ENUM은 이미 준비됐으나 권한 컬럼 migration이 DB grant에 의해 차단되어, HOS 통합 검증은 BLOCKED다. 운영 환경은 변경하지 않았다.

## 2026-11-03 TDKHOS DB 권한 재확인 및 DBA 절차

- 재확인한 실제 DB는 `TDK_POS_TEST` (MariaDB 10.11.18)이다. 접속 계정은 `tdk_pos@%`이며 해당 DB grant는 `SELECT, INSERT, UPDATE, DELETE`로 `ALTER`가 없다. 운영 DB에는 접속하지 않았다.
- `staff`에는 공통 `employee_pin_hash`가 있으나 `hos_enabled`는 없다. `staff`는 2행(활성·미퇴사 2명)이다. 직원 ID, 이름, 인증 해시 값은 확인/기록하지 않았다.
- `staff_sessions.session_type`은 이미 `ENUM('POS','ADMIN','KDS','HOS')`; 186행이다. 이 정의는 변경하지 않는다.
- HOS 컬럼 추가는 DBA 권한 오류로 거부된 상태이며 재시도하지 않았다. `hos_enabled`가 없으므로 직원별 HOS 권한 부여와 인증/주문 통합 테스트는 계속 중단한다.
- DBA용 최소 SQL을 `db-migrations/20261103_hos_enabled_column_test_admin.sql`로 작성했다. 이 파일은 `TDK_POS_TEST.staff`에만 `hos_enabled TINYINT NOT NULL DEFAULT 0`를 idempotent하게 추가하며, 기존 직원 모두 HOS OFF로 유지한다. 인증정보나 세션 행은 업데이트하지 않는다.
- 적용 방법: DBA가 개발 DB 관리 클라이언트에서 파일의 Step 1 `SELECT DATABASE()`만 먼저 실행한다. 결과가 반드시 `TDK_POS_TEST`일 때만 Step 2 ALTER를 실행하고, 이어 `SHOW COLUMNS`와 집계 SELECT 결과를 확인한다. 대상 DB가 다르면 파일의 나머지 문장을 실행하지 않는다. 개발 계정에 GRANT하지 않는다. 운영 DB/NAS에는 이 파일을 적용하지 않는다.
- DBA 작업 전까지 DB 변경, 테스트 직원 권한 부여, 로그인 성공 테스트 및 주문 쓰기 통합 테스트를 보류한다. 관리자 작업 후 컬럼/기본값/기존 행 수를 읽기 전용으로 확인한 뒤 격리된 테스트 직원으로 검증을 재개한다.
- 복구 지점: `.codex-backups/20261103-hos2-devdb-preflight.json`; 검증 기록은 이 파일에 포함되어 있다.

## 2026-11-03 TDKHOS 2차 통합 검증 재개 결과

### 개발 DB 구조

- 접속 대상과 `SELECT DATABASE()` 결과는 모두 `TDK_POS_TEST`였다. 운영 DB `TDK_POS`에는 접속하지 않았다.
- `staff.hos_enabled`는 `TINYINT(4) NOT NULL DEFAULT 0`으로 존재한다. 관리자가 추가한 컬럼을 확인했으며 Migration을 다시 실행하지 않았다.
- `staff_sessions.session_type` 정의에 `HOS`가 포함되어 있어 세션 ENUM 변경도 실행하지 않았다.
- 테스트 전후 기존 기준 행 수는 유지됐다: 직원 2, 테이블 12, 테이블 세션 310, 주문 343, 주문 항목 707, 직원 세션 186, HOS 신뢰 토큰 0. 최종 임시 테스트 데이터 cleanup 검사도 PASS했다.

### 격리 계정 인증 및 권한

- 임시 테스트 직원 1명과 전용 테스트 테이블 1개를 `TDK_POS_TEST`에만 만들고, 무작위 마스터 비밀번호와 PIN은 테스트 메모리에서만 사용했다. 실제 직원 인증정보는 조회·변경하지 않았다.
- HOS 마스터 비밀번호 인증과 보안토큰 발급, 최초 공통 PIN 등록, PIN 로그인, 로그아웃 후 재로그인 및 세션 유지가 실제 로컬 API에서 통과했다.
- HOS 전용 신뢰토큰이 없을 때 로그인은 HTTP 403으로 차단됐다. 임시 직원의 HOS 권한을 OFF로 바꿔 확인했을 때 PIN 로그인은 HTTP 403, 보호된 테이블 API는 HTTP 401이었다. 해당 임시 권한은 cleanup으로 제거됐다.
- 같은 임시 직원으로 POS, ADM, KDS의 마스터 인증·프로그램별 신뢰토큰 발급·PIN 로그인 API도 각각 통과했다. 실제 기존 직원 계정은 사용하지 않았다.

### 테이블 및 주문 흐름

- HOS 테이블 배치, 메뉴 카탈로그, 빈 테이블 상세 조회가 통과했다. POS 공용 테이블 API에서도 테스트 테이블이 조회됐다.
- HOS에서 8,000원 메뉴 2개를 전송했고 주문 상세와 테이블 받을 금액 16,000원을 확인했다.
- 2개 중 1개 부분 취소가 통과했다. HOS 주문 상세의 취소 수량/잔여 수량과 받을 금액 8,000원을 확인했다.
- `HosHome`의 전송 중 `sendLock`/`busy` 중복 클릭 차단과 요청 실패 시 오류 표시·잠금 해제는 소스에서 확인했다. 실제 브라우저 연속 클릭 테스트는 하지 않았다.
- KDS 대상 메뉴의 주문 상태(`ACCEPTED`), `kds_visible=1`, `kds_kind=SOLO`를 확인했다. 단, `/api/kitchen`은 기존 대기·조리 KDS 큐 166건(그중 조리 중 7건)을 동기화/정리하는 쓰기 부수효과가 있어 호출하지 않았다. 실제 KDS task 생성 및 KDS 화면 표시 여부는 미검증이다.
- 전송 후 화면이 테이블 목록으로 돌아가는 것과 UI 실패 표시 동작은 코드로 확인했으며 실제 터치 화면은 검증하지 않았다.

### 검사 결과

- TypeScript `npx.cmd tsc --noEmit`: PASS
- HOS 및 인증/주문 API 대상 ESLint: PASS
- 전체 저장소 ESLint는 실행이 프로젝트 내부 `.pos-runtime/chrome-profile/Default/Extensions`까지 스캔하며 지연되어 중단했다. 대상 파일 lint는 별도로 완료했다.
- 인증/제한 관련 자동화 테스트: PASS 15/15
- KDS 모델 관련 자동화 테스트(`node --experimental-strip-types --test`): PASS 43/43
- Next.js production build: PASS. 기존 `menu-image-storage.ts` 동적 파일 접근 경고 2건은 남아 있다.
- Chrome 실행 파일은 설치되어 있으나 기본 프로필 실행은 이미 점유/권한 오류로 실패했다. Playwright/Puppeteer 자동화 패키지와 Android `adb` 연결은 사용할 수 없어 실제 브라우저 로그인 UI 및 모바일 검증은 미수행이다.

### 데이터 정리 및 결론

- 테스트 직원, 프로그램 신뢰 토큰, 직원 세션, 테스트 테이블·주문·부분 취소·관련 KDS task를 제거했고 테스트 전 기준 행 수로 복구됨을 검증했다. 인증 실패 카운터 중 테스트 중 새로 생긴 항목도 정리했다.
- 이번 검증에서는 애플리케이션 인증/주문 소스를 변경하지 않았다. 운영 DB/NAS, Device Agent, 실제 직원 및 운영 주문 데이터는 변경하지 않았다.
- 결론: 개발 DB에서 HOS 인증, 권한 차단, 테이블/주문 추가·부분 취소 및 POS·ADM·KDS 인증 API 회귀는 PASS다. KDS 실시간 task 표시와 실제 브라우저·모바일 UI는 미검증이므로 운영 적용 준비 완료로 판정하지 않는다. 운영 배포 전 격리된 KDS 브라우저/태블릿 확인이 남아 있다.


\r\n

## 2026-11-03 TDKHOS 3차 실제 Chrome 및 POS·KDS 연동 검증

### 검증 환경 및 범위

- 개발 서버는 127.0.0.1:3119에만 바인딩하고 .env.local의 TDK_POS_TEST 연결을 확인했다. 운영 DB/NAS에는 접속하지 않았다.
- Chrome 기본 프로필은 사용하지 않고 별도 임시 프로필을 사용했다. viewport는 390×844 CSS px로 에뮬레이션했다.
- 앱 코드와 Device Agent는 수정하지 않았다. 실제 KDS 공용 큐 API /api/kitchen은 기존 큐를 동기화/정리할 수 있어 호출하지 않았다.

### 실제 Chrome 및 서버 관찰

- /tdkhos 요청이 앱의 /hos 화면으로 라우팅되고 TDK HOS 로그온 화면이 렌더링됐다.
- 테스트 직원에 대해 ID 상태 GET, HOS 최초 상태 POST, HOS 마스터 인증/신뢰토큰 발급 POST, 공통 PIN 등록 POST가 각각 HTTP 200으로 서버 로그에 기록됐다. PIN 등록 뒤 보호된 HOS 테이블 목록 GET도 HTTP 200이었다. 임시 HOS 세션 및 토큰은 검증 종료 후 제거됐다.
- 모바일 viewport에서 임시 테이블의 버튼 높이가 44px 이상이고 테이블/상세 화면의 가로 overflow가 없음을 브라우저 DOM 측정으로 확인했다. 테이블 상세 및 메뉴 카탈로그 GET도 HTTP 200이었다.
- 브라우저 자동화가 메뉴 카탈로그 응답 이후 CDP 프로토콜 예외(Object reference chain is too long)로 중단됐다. 따라서 메뉴 선택, 주문 추가/취소 버튼 상호작용, 전송 실패 화면 유지, 전송 후 배치 복귀는 실제 Chrome에서 미검증이다. 이 자동화 오류를 애플리케이션 오류로 판정하지 않았다.

### POS·KDS 데이터 연동 및 안전성

- 이번 Chrome 세션에서는 주문 POST가 발생하지 않아 POS 금액 반영과 KDS 주문 표시를 검증하지 않았다.
- 2차 개발 DB API 검증에서 주문 추가, 일부 수량 취소, 받을 금액 갱신은 이미 PASS로 기록되어 있다. 다만 이를 이번 차수의 브라우저 UI PASS로 간주하지 않는다.
- KDS 전역 큐 API를 호출하지 않았다. 종료 후 DB에는 KDS task 166건(그중 COOKING 7건)이 있었고 임시 HOS 작업은 0건이었다. 기존 큐 보호를 위해 실제 KDS 화면 반영 여부는 미검증으로 남긴다.

### 테스트 데이터 정리

- 이번 검증용으로 생성된 마커 직원 4명과 임시 테이블 4개를 TDK_POS_TEST에서 제거했다. 이 브라우저 시도에서는 해당 테이블에 연결된 주문 세션/주문은 생성되지 않았다.
- 종료 후 직원 2명, 테이블 12개, table_sessions 310개, orders 343개, order_items 707개, staff_sessions 186개로 이전 개발 DB 기준 수치와 같았다. 임시 직원 0명, 임시 테이블 0개, 활성 HOS 토큰 0개, 활성 HOS 세션 0개를 확인했다.
- 공유 인증 요청 제한 저장소는 이전 카운터 상태를 보존하기 위해 삭제/초기화하지 않았다. 종료 시 저장 행은 admin 2개, KDS IP 8개였으며 합계 시도 수는 각각 12와 43이었다. 이 값은 직원별 비밀번호/PIN 원문이나 IP 원문을 포함하지 않으며, 사전 스냅샷이 없어 기존 값과 이번 요청 증가분을 분리할 수 없다.
- 격리 Chrome 프로필과 3119 서버를 종료했다. 임시 자동화 스크립트를 삭제했다.

### 코드 검증

- TypeScript npx.cmd tsc --noEmit: PASS
- HOS 및 인증 관련 변경 경로 ESLint: PASS
- 관련 인증·PIN·테이블 계산 자동화 테스트: PASS 33/33
- Production Build: PASS. 기존 src/lib/menu-image-storage.ts 동적 파일 경로 tracing 경고 2건이 남아 있으며 이번 작업 범위에서 변경하지 않았다.

### 결론

- 결과: PARTIAL. HOS 브라우저 로그인, HOS 보호 API, 테이블 목록/상세 및 메뉴 카탈로그 응답까지 확인했다. 주문 UI 상호작용과 POS·KDS 실제 화면 반영은 완료하지 못했다.
- 모바일 검증은 Chrome 390×844 에뮬레이션만 수행했다. 실제 Android 태블릿/스마트폰 터치 검증은 미수행이다.
- 운영 적용 전에는 자동화/CDP 문제를 해결하거나 수동 Chrome으로 메뉴 선택 → 주문 추가 → 부분 취소 → POS 금액 확인을 재검증해야 한다. KDS 확인은 별도 안전한 격리 큐/DB에서 해야 한다.

## TDKHOS 4차 — 실제 모바일 수동 검증 환경 준비 (2026-11-03)

- 개발 서버 구조: `npm run dev` → `node server.cjs`; 기본 포트 3000, 기본 bind는 `0.0.0.0`. 모바일 테스트용 권장 실행은 프로젝트 폴더에서 `PORT=3000`, `TDK_APP_BIND_HOST=192.168.0.54`로 지정해 LAN 인터페이스에만 바인딩하는 방식이다.
- 개발 DB 연결을 `.env.local` 기준으로 읽기 전용 검증했으며 `SELECT DATABASE()` 결과는 `TDK_POS_TEST`였다. 운영 DB/NAS에는 접속하거나 변경하지 않았다.
- 준비된 격리 직원: `admin_login_id=hos_mobile_20261103_e4ff31`, 활성 일반 직원, HOS 권한 ON, POS/ADM/KDS 권한 OFF. 마스터 비밀번호와 공통 PIN 해시가 설정됨을 원문 조회 없이 확인했다. 인증정보는 이 문서에 기록하지 않는다.
- 준비된 빈 테스트 테이블: `table_id=28`, `table_no=HME4FF31`, 이름 `HOS Smartphone Test e4ff31`. 확인 당시 연결된 테이블 세션 0건, 직원 로그인 세션 0건이었다. HOS 전송 후 생성되는 세션/주문은 이 테스트 테이블 범위에서만 정리해야 한다.
- 개발 PC LAN IPv4: `192.168.0.54/24`. 스마트폰 접속용 개발 URL은 `http://192.168.0.54:3000/tdkhos`.
- 현재 Windows Private 방화벽은 인바운드를 차단하고 로컬 방화벽 규칙은 GPO 관리 대상이다. 포트 3000/3120에서 실행 중인 개발 서버 listener도 확인되지 않았다. 방화벽/GPO를 변경하지 않았고 서버도 실행 상태로 남기지 않았다.
- 따라서 모바일 접속은 아직 준비 완료가 아니다. 관리자가 Private 프로필에 한해 출발지 `192.168.0.0/24`, 목적지 `192.168.0.54`, TCP 3000만 허용해야 한다. Public 프로필 및 외부망 허용은 불필요하다.
- HTTPS 개발 인증서 도구/구성이 없어 이 주소는 HTTP다. 개발 모드는 HTTP를 허용하지만, 테스트용 인증정보만 사용해야 한다. 운영 도메인/NAS로 우회하지 않았다. HTTPS가 필수인 경우 내부 개발 DNS와 스마트폰이 신뢰하는 사설 인증서 구성이 별도로 필요하다.
- 사용 전 개발 PC에서 실행:
  ```powershell
  Set-Location 'D:\\10_프로그래밍_소스\\01_TDK_Web\\tdk-pos'
  $env:PORT = '3000'
  $env:TDK_APP_BIND_HOST = '192.168.0.54'
  npm.cmd run dev
  ```
  서버 시작 로그에서 개발 모드와 포트 3000을 확인한 뒤 같은 사내 Wi-Fi/VLAN의 스마트폰에서 위 URL에 접속한다. 게스트 Wi-Fi의 client isolation이 켜져 있으면 연결되지 않는다.
- 수동 순서: 테스트 직원 로그인 → 테스트 테이블 번호 확인 → 테이블 선택 → 메뉴 추가 및 수량/옵션 선택 → 전송 → 같은 테이블의 주문 및 받을 금액 확인 → 주문 항목 선택 → 취소 지정(가능하면 일부 수량) → 전송 → 갱신된 주문/금액 확인 → 테이블 배치 복귀. 이 단계에서 실제 스마트폰 조작은 수행하지 않았다.
- 검증 구분: 테스트 계정·권한·빈 테이블 준비 및 DB 식별은 확인 완료. 스마트폰 네트워크 접속, 모바일 UI, 주문 추가/취소 실제 브라우저 조작은 방화벽 GPO 예외와 사용자의 수동 테스트가 필요하여 미검증. TDK Device Agent, 운영 NAS, 기존 POS/ADM/KDS 코드는 변경하지 않았다.
- 정리 대상 식별자는 직원 `staff_id=271` / 코드 `HOS_MOB_e4ff31`, 테이블 `table_id=28` / 번호 `HME4FF31`이다. 테스트를 마친 뒤 이 범위에서 발생한 HOS 세션·주문 및 직원 세션/토큰을 FK 의존 순서에 따라 개발 DB에서만 정리하고 테이블·직원 레코드를 제거한다. 테스트 종료 전에는 삭제하지 않는다.


## TDKADM HOS 테이블 배치 관리 — 구현 계획 (2026-11-03)

1. 기존 ADM 보호 레이아웃, 사이드바, 관리 권한, POS 테이블 편집 API와 HOS 테이블 조회 계산을 조사한다.
2. POS 좌표와 분리된 HOS 표시 좌표·크기·표시 여부를 선택한다. 현재 개발 DB 계정은 기존 테이블 ALTER 권한이 없으므로 신규 테이블을 만들지 않고, 스키마가 있는 `system_settings`의 `hos.table-layout.<tableId>` 키를 사용한다. DB에서 현재 접두사 키는 0건이며 TDK_POS_TEST에 한정해 확인했다. POS 테이블 레코드/좌표는 쓰지 않는다.
3. HOS API와 ADM 미리보기가 동일한 계산·레이아웃 함수를 사용하도록 연결한다. 미저장 테이블은 번호순 3열 열 우선 초기 배치에 넣고, 비활성·숨김 상태와 겹침을 검증한다.
4. ADM 메뉴/페이지/권한/API와 터치 드래그·크기 조절·격자 정렬·표시 전환·초기화·미리보기·저장 확인을 구현한다.
5. TypeScript, ESLint, 관련 단위/API 테스트와 production build를 실행한다. 개발 DB 동작은 TDK_POS_TEST에서만 확인하며 운영 DB/NAS 변경은 하지 않는다.
6. QR 주문 대기 표시는 선행 코드 조사 결과 현재 HOS API가 `qrOrdersAvailable:false`를 반환하고 승인 대기 기능이 연결되어 있지 않다. 실제 대기 데이터 모델 확인 전에는 임의 상태를 만들지 않고 기존 안내/데이터를 보존한다.

복구 체크포인트: `checkpoints/20261103-hos-admin-layout-prechange.zip`.


## TDKADM HOS 테이블 배치 관리 구현 결과 (2026-11-03)

### 구현
- OWNER 전용 사이드바 항목 `HOS → 테이블 배치`와 관리 페이지를 추가했다. 페이지 및 저장 API 모두 현재 ADM 세션의 OWNER 권한을 서버에서 확인한다.
- ADM 미리보기와 실제 HOS 테이블 화면이 `HosTableCanvas`를 공유한다. 스마트폰 기준 3:4 배치 캔버스, 3열 기본 정렬, 숫자순 세로 배치, 그리드 스냅, 드래그 이동, 가로·세로 크기 조절, 숨김/표시, 기본 배치 초기화, 저장/취소 및 변경 확인을 제공한다.
- 빈 테이블은 밝은 배경에 번호를, 사용 중인 테이블은 파란 배경에 번호와 기존 계산된 받을 금액을 표시한다. 주문이 있는 테이블은 HOS에서 숨길 수 없도록 서버에서도 검사한다.
- HOS 좌표·크기·표시 여부는 기존 `system_settings`의 `hos.table-layout.<tableId>` 설정 키에 저장한다. POS 테이블 좌표와 테이블 레코드는 쓰지 않는다. 신규 테이블은 기존 설정과 겹치지 않는 안전한 3열 기본 위치를 배정한다.
- HOS 테이블 조회는 공통 데이터 서비스를 사용해 실제 화면과 ADM 미리보기 계산을 일치시킨다.

### DB 및 보호 범위
- 개발 DB 계정은 DDL 권한이 없어 새 테이블을 만들지 않았다. 저장 전 개발 DB 설정 키의 테스트 upsert/read를 트랜잭션 안에서 수행하고 롤백하여 영구 데이터 변경이 없음을 확인했다. 대상 DB는 `TDK_POS_TEST`였으며 운영 DB/NAS에는 접근하지 않았다.
- POS 테이블 좌표, POS 주문·결제 데이터, KDS 기능, Device Agent를 수정하지 않았다.
- 현재 HOS QR 승인 대기 API/데이터 연결은 미구현이며 API가 `qrOrdersAvailable:false`를 반환한다. 편집 화면은 이 제한을 명시하고 QR 상태를 만들어내지 않는다.

### 검증 결과
- TypeScript: PASS (`npm.cmd exec tsc -- --noEmit`)
- 변경 파일 ESLint: PASS
- HOS 배치 단위 테스트: PASS 6/6. 숫자순 3열 배치, 신규 테이블 기본 위치, 그리드 스냅, 테이블 수 1~90개 기본 배치의 유효성/비중첩, 가장자리 제한을 검증했다.
- Production Build: PASS. 신규 `/admin/hos/table-layout`, `/api/admin-center/hos/table-layout`, HOS API 경로가 빌드에 포함됐다. 기존 `src/lib/menu-image-storage.ts`의 동적 파일경로 tracing 경고 2건은 남아 있으며 이번 작업과 무관하다.
- `git diff --check`: 코드 변경 오류 없음. 저장소의 기존 CRLF/LF 변환 경고만 출력됐다.
- 실제 Chrome/스마트폰/태블릿 화면의 드래그, 저장 후 재접속, 실제 QR 대기 표시 검증은 수행하지 않았다. 실제 기기 UI PASS로 처리하지 않는다.

복구 체크포인트: `checkpoints/20261103-hos-admin-layout-prechange.zip`.


## TDKADM 관리 화면 공통 콘텐츠 정렬 조정 (2026-11-03)

### 변경
- 공통 `.content` 래퍼에서 1200px 최대 폭과 좌우 자동 여백을 제거하고 남은 작업 영역 너비를 사용하도록 변경했다. 데스크톱 콘텐츠 시작점은 사이드바 너비 + 기존 본문 왼쪽 여백이며, 사이드바 너비와 패딩은 그대로다.
- 메뉴와 영업마감 목록은 내부 최대 너비도 제거해 넓은 화면을 활용한다. 할인, 기타 결제, POS/KDS 및 인쇄/포장 설정은 페이지 래퍼의 중앙 정렬을 제거하고, 폼에 필요한 기존 폭 제한은 유지한다.
- HOS 배치 화면은 공통 콘텐츠 폭을 그대로 받으며, 기존 스마트폰 미리보기와 우측 설정 패널 구성은 변경하지 않았다. HOS 편집/저장 로직과 권한은 변경하지 않았다.
- 모달의 `fixed` 중앙 정렬과 모바일 반응형 사이드바/본문 간격은 유지했다. DB, API, 인증 권한 및 업무 기능은 변경하지 않았다.

### 검증
- 공통 래퍼가 적용된 ADM 페이지 17개를 조사했다.
- TypeScript: PASS (`npm.cmd exec tsc -- --noEmit`)
- 변경 페이지 ESLint: PASS. CSS Module은 ESLint 설정 대상이 아니어서 해당 파일을 ESLint가 건너뛰었다.
- Production Build: PASS. 기존 `src/lib/menu-image-storage.ts` 동적 파일경로 tracing 경고 2건은 유지된다.
- 1920px/1366px/태블릿 브라우저 실제 렌더링 캡처는 이 환경에서 수행하지 않았다. CSS상 본문은 동일한 사이드바 옆 좌측 시작을 유지하고, 태블릿에서는 기존 반응형 규칙을 사용한다.

## TDKHOS 메인 화면 및 갱신 동작 정리 (2026-11-04)

- `src/app/hos/HosHome.tsx`의 테이블 메인 화면에서 `테이블 배치` 제목과 수동 새로고침 버튼을 제거했다. 기존 흰색 헤더, 로그인 직원 ID, 로그아웃 및 헤더 구분선은 유지했다.
- 기존 테이블 상태 자동 조회 주기인 6초를 유지한다. 테이블 화면에 진입하거나 상세 화면에서 돌아올 때 즉시 조회하고, 테이블 화면을 벗어나면 자동 타이머를 정리한다. 주문 상세 화면의 기존 5초 주문 조회는 변경하지 않았다.
- 테이블 화면 최상단에서 64px 이상 아래로 당겼다 놓으면 `/api/hos/tables`만 즉시 다시 조회하는 Pull to Refresh를 추가했다. 제스처 중 브라우저의 페이지 당김 새로고침을 막고, 당김 안내와 갱신 중 표시를 제공한다. 상세/메뉴 입력 화면에서는 갱신을 실행하지 않고 브라우저 기본 당김 새로고침만 막아 입력 중 데이터를 보호한다. 내부 스크롤 목록은 스크롤 위치에 따라 계속 스크롤할 수 있다.
- 자동·수동 요청은 진행 중 Promise를 공유하여 중복 호출을 막는다. 결과 갱신은 테이블 상태만 바꾸므로 주문 draft, 취소 예정 상태, 선택 화면 및 HOS 테이블 배치 좌표를 초기화하지 않는다. 실패는 기존 화면 오류 안내를 사용한다.
- 검증: `npx.cmd tsc --noEmit` PASS, `npx.cmd eslint src/app/hos/HosHome.tsx` PASS, `npm.cmd run build` PASS. Production build에서 `src/lib/menu-image-storage.ts`의 동적 파일 경로 추적 관련 기존 경고 2건이 출력됐다.
- 실제 Android 스마트폰/태블릿 브라우저 터치 검증은 이 환경에서 수행하지 않아 미검증이다. 특히 OS/브라우저별 native pull-to-refresh 억제와 실제 터치 감도는 기기에서 확인해야 한다.

## TDKHOS 테이블 버튼 정보 배치 개선 (2026-11-04)

- `src/app/hos/HosTableCanvas.tsx`의 실제 HOS 표시에서 사용 중 테이블을 상단 좌·우(테이블 번호, 실제 받을 금액), 하단 좌·우(인원, 상태) 영역으로 배치했다. HOS 편집 미리보기의 기존 표시 방식은 유지했다.
- 받을 금액은 기존 `/api/hos/tables` 응답의 `amountDue`를 그대로 사용한다. 해당 응답은 기존 `calculateTableFinancials` 공유 계산 결과를 사용하며, POS 계산 로직이나 별도 계산은 추가하지 않았다.
- 테이블 인원은 기존 세션의 `personCount + babyCount`를 사용하고 합계가 0이면 표시하지 않는다. 일반 빈 테이블은 번호만 중앙 표시한다. 테이블별 저장 위치·크기 및 반응형 좌표 적용은 변경하지 않았다.
- QR 표시는 `hasQrOrder`가 실제로 제공될 때만 표시할 수 있도록 상태 영역을 준비했다. 현재 HOS 테이블 API는 `qrOrdersAvailable: false`이며 QR 대기 플래그를 전달하지 않으므로 QR 표시를 만들지 않았다. 병합 테이블의 기존 상태 표시는 하단 상태 영역에서 유지한다.
- 검증: `npx.cmd tsc --noEmit` PASS, `npx.cmd eslint src/app/hos/HosTableCanvas.tsx src/app/hos/HosHome.tsx` PASS, `npm.cmd run build` PASS. 빌드 중 `src/lib/menu-image-storage.ts`의 동적 파일 경로 추적 경고 2건이 출력됐다.
- 실제 스마트폰·태블릿 렌더링, POS 화면과의 실데이터 금액 대조 및 주문 상태 시각 확인은 이 환경에서 수행하지 않아 미검증이다.

## TDKKDS PWA 방향 강제 원인 및 수정 (2026-11-04)

- KDS 페이지(`/tdkkds`, 내부 경로 `/kitchen`)는 `src/app/kitchen/layout.tsx`에서 `/tdkkds/kds.webmanifest`를 명시한다. 렌더링된 로컬 HTML에서도 동일한 `rel=manifest` 경로를 확인했다. `/kds.webmanifest`는 `public/kds.webmanifest`에서 제공되는 별도 정적 파일이며 KDS 페이지의 링크 대상이 아니다.
- 실제 수정 전 `http://127.0.0.1:3000/tdkkds/kds.webmanifest` 응답은 `display: fullscreen`, `display_override: [fullscreen, standalone]`, `orientation: landscape`였다. 원인은 `src/lib/kds-manifest.ts`가 공통 Manifest의 방향을 `landscape`로 덮어쓴 설정이다. `screen.orientation.lock()` 호출은 KDS 또는 공통 코드에서 발견되지 않았다. `requestFullscreen()` 검색 결과는 POS 코드뿐이며 방향 잠금과는 무관하다.
- KDS 전용 적용 함수의 orientation을 `any`로 변경해 세로·가로 모두 허용하며, fullscreen/display_override 설정은 유지했다. POS·ADM·HOS Manifest 및 인증/조리 코드는 변경하지 않았다. `public/kds.webmanifest`도 이미 `any`이며 이번 변경 대상이 아니다.
- Manifest 라우트는 `Cache-Control: no-store`로 응답하고 프로젝트에서 Service Worker 등록 코드나 서비스워커 파일을 찾지 못했다. 변경 후 로컬 실제 응답이 `orientation: any`인 것을 확인했다. 운영 도메인은 이 환경에서 원격 연결이 되지 않아 현재 배포 응답은 미확인이다.
- 검증: Manifest 단위 테스트 5/5 PASS, TypeScript PASS, 관련 ESLint PASS, Production Build PASS. 빌드에서 기존 `src/lib/menu-image-storage.ts` 동적 파일 경로 추적 경고 2건이 출력됐다. Android 태블릿 실기기 검증은 미수행이다.
- 태블릿 적용: 수정 소스를 운영 서버에 배포한 뒤 브라우저에서 정확한 KDS 주소를 한 번 열어 새 Manifest를 읽게 하고, 설치 앱을 닫았다 다시 실행한다. 계속 가로 고정이면 KDS 설치 앱만 제거 후 같은 주소에서 다시 설치한다(Chrome/Edge 브라우저 데이터 전체 삭제는 불필요). 시스템 빠른 설정의 자동 회전이 켜져 있는지 확인하고, 제조사에 앱별 방향 잠금 설정이 있으면 KDS에 고정 방향이 지정되지 않았는지 확인한다. Chrome과 Edge는 일반 탭과 설치 앱의 매니페스트 적용/업데이트 시점이 다를 수 있으므로 태블릿별 재검증이 필요하다.

## TDKPOS 신뢰 토큰 일일 재인증 원인 조사 (2026-11-04)

- 토큰 원문은 브라우저의 `tdk_pos_trust_<tokenId>` HttpOnly 쿠키에만 두고, DB `program_trust_tokens.token_hash`에는 SHA-256 해시만 저장한다. 쿠키는 host-only, `Path=/`, `Secure`, `SameSite=Strict`, `Max-Age=400일`이며 유효한 토큰 상태 조회 때 같은 쿠키를 재설정해 수명을 갱신한다.
- DB 신뢰 토큰 테이블에는 만료시각 필드가 없고 검증은 프로그램 POS 일치, 미폐기, 등록 직원 활성·미퇴사·POS 권한 ON을 확인한다. 토큰은 서버 메모리/프로세스 키가 아닌 DB 해시로 검증되므로 애플리케이션 재시작 자체로 무효화되지 않는다.
- 직원 POS 세션 쿠키는 HttpOnly, SameSite=Lax, 운영 Secure, 12시간 Max-Age이며 DB `loggedInAt`도 12시간 이내인지 확인한다. 따라서 하루 뒤 ID/PIN 재로그인은 정상 세션 만료일 수 있지만, 정상 토큰 쿠키가 있으면 마스터 비밀번호는 다시 요구하지 않아야 한다.
- POS 자동 실행 경로 차이를 확인했다. `deploy/start-pos-kiosk.ps1`은 `%LOCALAPPDATA%\TDK-POS\EdgeProfile`의 지속 프로필을 사용하지만 `배포/TDKPOS_Start.bat`은 기존에 Edge 기본 프로필을 사용했다. 다른 프로필에서 신뢰를 등록하고 다른 런처로 실행하면 쿠키가 공유되지 않아 `trustStatus`가 `trusted:false`를 반환하고 마스터 인증을 요구할 수 있다. POS 장비의 실제 로그인 경로/작업은 이 개발 호스트에서 확인할 수 없어 이것이 현장 증상의 직접 원인인지는 미확정이다.
- 재발 방지를 위해 `배포/TDKPOS_Start.bat`을 PowerShell 런처와 같은 지속 전용 프로필 `%LOCALAPPDATA%\TDK-POS\EdgeProfile`로 통일했다. `--inprivate`, 프로필 삭제, 쿠키 삭제는 적용하지 않았다. 기존 기본 프로필에만 신뢰가 등록되어 있었다면 새 전용 프로필에서 한 번 마스터 인증/등록 후부터 해당 프로필에 유지된다.
- 실제 POS PC의 예약 작업은 이 호스트에 없어 조회되지 않았다. 현장 적용 후 POS 작업이 `deploy/register-pos-task.ps1`가 등록한 `start-pos-kiosk.ps1`를 호출하는지 확인해야 한다. 두 런처를 섞어 실행하지 않고 동일 프로필을 유지한다.
- 검증: 프로그램 신뢰·등록·인증 흐름 테스트 17/17 PASS, TypeScript PASS, 관련 ESLint PASS, Production Build PASS. 기존 `src/lib/menu-image-storage.ts` 동적 파일 경로 추적 경고 2건이 있었다. 운영 DB, NAS, 직원 토큰/데이터는 조회·변경하지 않았다. 현장 Edge 재부팅 후 쿠키 존속은 이 개발 호스트에서 실제 확인할 수 없어 미검증이다.
