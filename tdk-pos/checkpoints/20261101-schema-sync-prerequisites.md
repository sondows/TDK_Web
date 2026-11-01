# TDKON DB 동기화 선행 정보 체크포인트 — 2026-11-01

상태: BLOCKED — 전체 운영 동기화 SQL은 아직 생성할 수 없음. DB/소스 변경 및 SQL 실행은 없었다.

## VIEW 접근

- Current principal `tdk_pos@%`; TEST에 SHOW VIEW 권한 없음. 운영에는 있음.
- TEST VIEW 6개 모두 SHOW CREATE에서 ER_TABLEACCESS_DENIED_ERROR. 정보 스키마 VIEW_DEFINITION도 미제공.
- DBA 파일 `sql/schema-sync/00_dba_show_view_grant.sql`은 TEST에만 SHOW VIEW 최소 권한을 요청한다. 실행하지 않았다.
- 권한 후 추출용 `sql/schema-sync/05_view_definition_extract.sql`을 준비했다.
- 운영 VIEW 참조 테이블은 계획 문서에 기록. TEST와의 참조 비교는 미완료.

## HOS

운영 staff.hos_enabled 정의: TINYINT(4), NOT NULL, DEFAULT 0, 빈 COMMENT, EXTRA 없음, ordinal 23, 인덱스 없음. 개발 DB에는 없다. 현재 앱 소스에서 직원관리 및 프로그램 접근 권한에 HOS 값이 쓰인다. 운영 컬럼은 유지한다.
개발 스키마 추가안 `sql/schema-sync/06_development_hos_column.sql` 생성, 미실행. HOS 컬럼 제거 DROP 예시는 rollback 파일에 주석으로만 남김.

## managed_devices

DB API CRUD는 현재 소스에서 확인되지 않았으나 ORM 선언, staff_sessions의 managed_device_id 조회와 FK가 남아 있다. FK는 ON DELETE SET NULL / ON UPDATE RESTRICT. TEST 3행(POS 승인/KDS 폐기/ADM 거부), 운영 6행(POS 승인 3/KDS 대기 1/승인 2) 및 레거시 토큰성 필드가 남아 있음. HOS/QRS 완료 후 정리 후보로 분류하고 즉시 DROP/ENUM 확장하지 않는다.

## SQL 초안

`01_preflight.sql`에 현재 사용자 및 안전한 권한 점검 보완. `02_production_schema_sync.sql`에서 managed_devices ENUM ALTER를 제거하고 실행 보류로 변경. `03_verify.sql`은 읽기 전용. `04_rollback.sql`에서 active DDL 제거; 개발 HOS 컬럼 롤백은 기본값 여부 검사와 주석 안내만 포함.

추가 파일: `00_dba_show_view_grant.sql`, `05_view_definition_extract.sql`, `06_development_hos_column.sql`.

전체 SQL 완성 선행 순서: SHOW VIEW 권한 승인 → VIEW 6개 정의/참조 비교 → 개발 DB HOS 컬럼 별도 승인 및 반영 → HOS/QRS 완료 후 managed_devices 정리 정책 확정 → 전체 재비교 → production DDL 생성.

SHOW GRANTS 원문은 password verifier 포함 가능성 때문에 저장하지 않았다. 민감정보·해시·토큰 원문을 이 체크포인트에 포함하지 않는다.