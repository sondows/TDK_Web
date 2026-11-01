# TDKON 개발 DB → 운영 DB 동기화 체크포인트 — 2026-11-01

상태: PARTIAL

## 적용 완료

- `.env.local`에서 연결하되 각 연결에서 `SELECT DATABASE()`로 DB 식별 확인.
- `TDK_POS_TEST` 기준으로 `sondows`, `jindows` 직원 프로필/역할/활성·퇴사 상태/POS·ADM·KDS 권한과 마스터 비밀번호·공통 PIN 해시를 운영 `TDK_POS`에 동기화.
- 운영 직원 PK와 업무 FK 참조 유지. OWNER 멤버십/owner 설정 매핑은 이미 같아 수정하지 않음.
- 운영의 `staff.hos_enabled` 컬럼을 보존하고 두 직원의 값은 HOS 미활성(0)으로 설정.
- 두 직원의 활성 운영 세션 17건을 로그아웃 처리. 대상 활성 신뢰 토큰은 전후 0건.
- 업무 데이터 변경 전후 지문 일치: orders 1,419; payments 551; checkouts 518; audit_logs 111; inventory_transactions 752; table_sessions 587.
- 구형 PIN 컬럼과 값은 변경하지 않음. 현재 운영 비NULL 집계: POS 2, 관리자 2, KDS 0.

## 미완료

- `managed_devices.device_type` ENUM 확장(운영 현재 `ENUM('POS','KDS')`)은 DB 계정에 ALTER 권한이 없어 적용되지 않음. 변경 전 관리 기기 값은 POS 3, KDS 3.
- 개발 DB `SHOW CREATE VIEW` 권한 부족으로 6개 VIEW 정의를 비교/동기화하지 않음.
- 34개 컬럼 위치 차이는 불필요한 ALTER를 피하기 위해 유지.
- 실제 백업 복구 리허설은 격리 DB가 없어 미실시. 백업 무결성과 보관 상태만 검증함.

## 백업

- `checkpoints/private-staff-cleanup/20261101-TDK_POS-full-before-auth-sync.json.gz`
- `checkpoints/private-staff-cleanup/20261101-TDK_POS_TEST-staff-auth-before-sync.json.gz`

인증 해시가 포함된 백업이므로 기존 restricted ACL과 `.gitignore` 제외 상태를 유지한다. 해시·비밀번호·PIN 원문은 이 체크포인트에 포함하지 않는다.