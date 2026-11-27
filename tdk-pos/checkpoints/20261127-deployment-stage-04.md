# TDKON 배포 준비 4단계: TV-7 운영 활성화 준비

## 운영 차단 원인과 수정

- 이전 기능 게이트는 `NODE_ENV=development`, `DB_NAME=TDK_POS_TEST`, 플래그 `true`만 허용했다. 고객 화면과 요청·검증·주문 API가 같은 운영 불가 상태였다.
- 운영 호스트 정책은 `/api/qr/order-auth`와 `/api/qr/order-auth/verify`를 별도로 거부했다.
- 변경 후 플래그 기본값은 OFF다. `development/TDK_POS_TEST` 또는 `production/TDK_POS` 조합만 허용하며, 실제 연결 DB 이름과 TV-7 필수 컬럼을 조회해 일치할 때만 ON으로 간주한다.
- 플래그가 ON인데 연결·스키마 검증에 실패하면 고객 주문 생성 API는 503으로 중단한다. 기존 무인증 주문 경로로 우회하지 않는다.
- 운영 호스트에서는 위 두 고객 인증 API의 필요한 GET/POST/DELETE 경로만 기존 QR 경로 허용 목록으로 통과시킨다. API의 QR 세션 검사와 동일 출처 검사는 유지된다.

## 운영 DB 읽기 전용 확인 근거

직접 DB 접속은 `EACCES`로 실패했다. 사용자가 phpMyAdmin에서 제공한 `TDK_POS`의 `information_schema` 결과를 확인했다. 세션의 현재 DB 표시는 `information_schema`였으나 모든 메타데이터 쿼리는 `TABLE_SCHEMA='TDK_POS'`를 지정했다.

- MariaDB 10.11.18, `qr_table_order_claims`와 `qr_order_auth_attempts` 존재.
- 인증 시도의 `table_session_id_at_auth`는 nullable `BIGINT UNSIGNED`, `session_snapshot_recorded`는 `TINYINT UNSIGNED NOT NULL DEFAULT 0`.
- 대표 테이블의 기본키, 인증 시도 기본키와 `(qr_session_id, client_request_id)` 고유키, 주요 외래키 확인.
- `tv_qr_auth_code_state`의 `state_id`, `code`, `expires_at` 확인.
- 제공된 결과로는 TV-7 관련 추가 운영 마이그레이션이 필요하지 않다. 전체 `SHOW CREATE TABLE` 비교, 운영 데이터 내용, 앱 DB 계정의 `information_schema` 조회 권한은 별도 확인이 필요하다.

읽기 전용 재확인용 SQL: `db-migrations/20261127_tv7_production_preflight.sql`. 운영용 생성 SQL 초안은 기존 테이블이 이미 확인돼 제거했다.

## 배포 시 설정과 미확인 항목

- NAS `.env.production`에는 `TDK_QR_ORDER_AUTH_ENABLED=false`를 유지해 최초 배포한다. 실제 활성화 시 `true`로 바꾸고 앱 컨테이너를 다시 생성해야 환경 변수가 반영된다. 이번 단계에서는 NAS 환경을 변경하지 않았다.
- 로컬 정책 테스트 16건, API 접근 테스트 30건, TypeScript, 변경 코드 ESLint, 프로덕션 빌드가 통과했다. 빌드 경고 2건은 기존 메뉴 이미지 저장 경로 추적에 관한 것이다.
- TV-7C/7D 실제 HTTP·DB 통합 테스트는 이번 턴에서 실행하지 못했다. 개발 DB 연결이 `EACCES`로 막혀 있다. 이전 체크포인트의 통과 기록과 이번 실행 결과를 구분한다.
- NAS 이미지 파일과 권한, 현재 운영 빌드, 실제 HTTPS 요청, DP1/HOS/스마트폰 브라우저 동작은 미검증이다. 운영 DB 데이터는 변경하지 않았다.
