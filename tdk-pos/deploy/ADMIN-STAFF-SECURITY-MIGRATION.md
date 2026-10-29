# ADM 직원 로그인 및 OWNER 보안 전환

운영 적용 전 `TDK_POS_TEST`에만 먼저 적용하고 로그인·보안 메뉴·기기등록을 확인합니다. 운영 DB와 NAS에는 별도 승인 없이 적용하지 않습니다.

## 1. 사전 확인

현재 DB 선택과 컬럼을 확인합니다. 직원 PIN 해시 값은 조회하거나 공유하지 않습니다.

```sql
SELECT DATABASE();
SHOW COLUMNS FROM staff LIKE 'employee_pin_hash';
SHOW COLUMNS FROM staff LIKE 'admin_enabled';
SELECT staff_id, staff_code, role, is_active, admin_enabled, admin_login_id IS NOT NULL AS has_legacy_adm_id,
       employee_pin_hash IS NOT NULL AS has_shared_pin
FROM staff
WHERE staff_code <> '000'
ORDER BY staff_id;
SELECT staff_id, staff_code, role, is_active FROM staff WHERE role = 'OWNER';
```

## 2. 테스트 DB 마이그레이션

`TDK_POS_TEST`를 선택한 상태에서 `db-migrations/20261030_admin_owner_security.sql` 전체를 적용합니다. 이 SQL은 컬럼/설정 테이블을 추가하고 기존 ADM 자격 증명이 있는 직원을 `admin_enabled=1`로 백필합니다. PIN 해시, 세션, 직원, 주문 데이터를 삭제하지 않습니다.

```sql
SELECT DATABASE();
SHOW COLUMNS FROM staff LIKE 'admin_enabled';
SHOW COLUMNS FROM staff_sessions LIKE 'owner_reauthenticated_at';
SELECT settings_id, owner_staff_id, owner_security_password_hash IS NOT NULL AS owner_password_configured,
       device_registration_password_enabled
FROM admin_security_settings;
```

마이그레이션은 우선 손창호의 기존 ADM 로그인 ID `sondows`가 활성화된 단일 관리 계정과 일치하면 그 행의 숫자 `staff_id`를 `owner_staff_id`에 저장합니다. 일치하지 않으면 활성 OWNER가 정확히 1명일 때만 그 계정을 지정합니다. 둘 다 모호하거나 불일치하면 NULL로 남으며, 그 상태에서는 보안 메뉴가 차단됩니다.

```sql
SELECT staff_id, staff_code, name, role, is_active, admin_enabled
FROM staff WHERE role = 'OWNER';
```

손창호 계정이 지정되었는지 확인할 때 로그인 ID로 직원의 숫자 `staff_id`를 대조합니다. 이름/로그인 ID는 확인용으로만 쓰고 실제 런타임 권한은 저장된 숫자 ID로 검사합니다.

```sql
SELECT staff_id, staff_code, name, role, is_active, admin_enabled
FROM staff
WHERE LOWER(admin_login_id) = LOWER('sondows');
```

결과가 손창호의 단일 직원 행인지 확인합니다. 마이그레이션 결과가 NULL이거나 다른 직원으로 지정된 경우에만 테스트 DB에서 아래 쿼리로 수정합니다. 이 변경은 DB 관리자가 직접 수행하며 일반 직원 API나 브라우저에서 OWNER를 지정할 수 없습니다. 운영 DB에서는 별도 승인 후에만 적용합니다.

```sql
UPDATE admin_security_settings
SET owner_staff_id = <확인한_손창호_staff_id>, updated_at = CURRENT_TIMESTAMP
WHERE settings_id = 1;
UPDATE staff_sessions SET owner_reauthenticated_at = NULL WHERE session_type = 'ADMIN';
```

ADM 접근을 위해 해당 직원 행은 활성 상태이고 `admin_enabled=1`이면 일반 관리센터에 접근할 수 있습니다. 마이그레이션은 기존 ADM ID/PIN이 있던 계정을 자동 보존합니다.

활성 OWNER가 기존 ADM 로그인 계정이 아니어서 `admin_enabled=0`인 경우, ADM 접근 권한을 임의로 넓히지 않습니다. `staff_id`와 직원을 확인한 후 **테스트 DB에서만** 아래처럼 지정 OWNER에게 필요한 ADM 권한을 수동으로 부여하고 로그인/PIN을 확인합니다. 운영 DB에서는 별도 승인과 변경 기록을 먼저 준비합니다.

```sql
UPDATE staff
SET admin_enabled = 1
WHERE staff_id = <확인한_OWNER_staff_id> AND role = 'OWNER' AND is_active = 1 AND staff_code <> '000';

UPDATE admin_security_settings
SET owner_staff_id = <동일한_OWNER_staff_id>
WHERE settings_id = 1 AND (owner_staff_id IS NULL OR owner_staff_id = <동일한_OWNER_staff_id>);
```

## 3. 단계 전환 동작

- POS/KDS 공통 `employee_pin_hash`가 설정된 직원은 해당 6자리 PIN으로 로그인합니다.
- 미전환 직원은 기존 POS/KDS PIN 해시를 유지해 기존 영업이 계속됩니다. 공통 PIN은 기존 숫자에 0을 붙여 만들지 않습니다.
- ADM은 활성 직원의 `admin_enabled=1`을 서버에서 확인합니다. 읽기·쓰기 세부 권한은 사용하지 않습니다. 공통 PIN 해시가 있으면 공통 PIN을 사용하고, 아직 없는 기존 계정은 기존 ADM PIN 해시를 임시 호환 경로로 씁니다.
- 직원관리에서 각 직원의 공통 PIN을 설정·검증한 후 별도 일정으로 POS/KDS/ADM을 확인합니다. 모든 해당 계정 전환이 끝난 뒤에만 구형 해시 인증 제거를 별도 변경으로 진행합니다.
- 기존 `pin_hash`, `kds_pin_hash`, `admin_pin_hash`, `kds_password_hash`는 이번 코드에서 삭제하지 않습니다.

## 4. OWNER 2차 비밀번호 및 복구

지정 OWNER가 기존 ADM 직원 선택 + PIN으로 로그인하고 `보안 → 직원관리` 또는 `보안 → 기기관리`에 처음 진입하면 특수문자를 포함한 10자 이상 OWNER 보안 비밀번호를 설정합니다. 이후 추가 비밀번호 인증은 5분간 유효하며 브라우저 세션을 로그아웃하면 다시 필요합니다. 비밀번호 원문은 저장·기록되지 않습니다.

비밀번호를 잊었을 때는 웹에서 우회 초기화하지 않습니다. 승인된 DB 관리자가 직원 코드와 고유 `staff_id`를 대조한 후 백업/변경 기록을 남기고 다음 복구만 실행합니다.

```sql
-- 먼저 아래 SELECT 결과에서 owner_staff_id와 대상 staff_id가 같은지 수동 대조합니다.
SELECT owner_staff_id FROM admin_security_settings WHERE settings_id = 1;
SELECT staff_id, staff_code, role, is_active FROM staff WHERE staff_id = <확인한_OWNER_staff_id>;

-- 해당 OWNER 보안 비밀번호 초기화 및 모든 ADM 세션의 2차 인증 무효화
UPDATE admin_security_settings
SET owner_security_password_hash = NULL, updated_at = CURRENT_TIMESTAMP
WHERE settings_id = 1 AND owner_staff_id = <확인한_OWNER_staff_id>;
UPDATE staff_sessions SET owner_reauthenticated_at = NULL WHERE session_type = 'ADMIN';
```

그 다음 지정 OWNER가 ADM에 다시 로그인해 보안 메뉴에서 새 비밀번호를 설정합니다. OWNER ID 변경이 필요한 복구는 관리자 DB 절차로 검토하며 일반 직원 API에는 제공하지 않습니다.

## 5. 롤백

문제가 생기면 앱 코드만 이전 배포본으로 되돌립니다. 새 컬럼/테이블과 해시는 그대로 두며 데이터베이스를 초기화하거나 새 테이블을 삭제하지 않습니다. 이전 ADM ID/PIN 데이터와 POS/KDS PIN 해시는 보존되므로 필요 시 이전 앱으로 로그인할 수 있습니다.

테스트 DB 검증 완료 후 운영 SQL 적용이 필요하면, 이 문서와 실제 영향 범위를 별도 승인 대상으로 제출합니다.
