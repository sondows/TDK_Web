# TDKON 스키마 동기화 SQL 생성 체크포인트 — 2026-11-01

상태: SQL 초안 생성, 전체 운영 스키마 동기화는 BLOCKED. 이 작업에서는 DB를 읽기 전용으로 조사했으며 생성한 SQL을 실행하지 않았다.

## 확인 결과

- MariaDB 10.11.18, TEST/PROD 각 DB명을 `SELECT DATABASE()`로 확인.
- 양쪽 85 base tables, 6 views. 테이블/엔진/Collation 일치.
- 컬럼 수 753/754. PROD에만 `staff.hos_enabled`.
- 정의 차이: `managed_devices.device_type` TEST `ENUM('POS','KDS','ADM','HOS')`, PROD `ENUM('POS','KDS')`.
- 34 column ordinal differences: staff 20, managed_devices 14. 인덱스 324, FK 항목 120의 정의 차이는 없음. 트리거/루틴/이벤트 0개.
- 6개 TEST VIEW 정의 조회는 SHOW VIEW 권한 오류. 임의의 CREATE VIEW를 만들지 않음.
- HOS 권한은 현재 소스가 사용하므로 PROD 컬럼을 DROP하지 않음. 개발 스키마가 앱 소스보다 뒤처져 있어 TEST 구조 보완 후 재비교 필요.
- 관리기기 ENUM은 소스 스키마가 ADM/HOS를 선언하고 기존 데이터 POS/KDS는 유지되므로 비파괴 확장 SQL을 생성함.
- 위치 차이 테이블 대상으로 SELECT * / 컬럼 미지정 INSERT 사용을 찾지 못해 컬럼 재배치 SQL은 생성하지 않음.

## 생성 파일

- `sql/schema-sync/01_preflight.sql`
- `sql/schema-sync/02_production_schema_sync.sql` — ENUM 확장만 포함, 전체 스키마 동기화본 아님.
- `sql/schema-sync/03_verify.sql`
- `sql/schema-sync/04_rollback.sql` — ADM/HOS 데이터가 0일 때만 ENUM 축소 가능. DDL은 자동 커밋.

## 실행 전 필수 조건

1. TDK_POS_TEST의 SHOW VIEW 권한 확보 후 6개 VIEW 정의와 참조 DB/테이블 비교.
2. HOS 컬럼을 개발·운영 양쪽에서 유지할 최종 구조 확정. 안전한 권고는 개발 DB에 소스가 기대하는 HOS 구조를 별도 승인으로 보완.
3. 운영 DB 백업 후 DBA ALTER 권한으로 검토된 02만 실행.
4. 03 검증 실행 후 운영 업무 행 수를 사전 결과/백업과 대조.

환경변수, 접속 비밀번호, 해시, 토큰은 포함하지 않는다.
운영 VIEW 참조 테이블: v_daily_menu_sales→order_items; v_daily_theoretical_ingredient_usage→order_items/menu_recipes/inventory_items; v_inventory_status→inventory_items; v_open_table_sessions→dining_tables; v_session_order_totals→orders; v_supplier_payables→suppliers/purchase_payment_allocations. TEST 정의가 없어 참조 동일성은 미확인이다.
