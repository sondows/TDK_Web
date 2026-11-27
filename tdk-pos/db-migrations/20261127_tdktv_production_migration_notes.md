# TDKTV 운영 DB 마이그레이션 준비 (2026-11-27)

운영 DB `TDK_POS`를 직접 수정하지 않고, phpMyAdmin에서 검토·적용할 SQL을 준비했다.

## 재확인된 현재 상태

- 운영·개발 DB 모두 `tv_images`, `tv_image_events`, `tv_qr_auth_code_state`가 있다.
- 운영 `tv_screens`는 14컬럼이며 `transition_effect`, `physical_order`, `layout_x`, `layout_y`가 없다. 개발 스키마에는 네 컬럼이 있다.
- 운영에는 `tv_sync_groups`, `tv_business_notice`가 없고 개발 DB에는 있다.
- 운영 화면은 ID 1~5를 기존대로 사용한다: `MENU-01`, `MENU-02`, `MENU-03`, `MENU-04`, `AD-01`. 개발 DB에서는 같은 ID가 DP2, DP3, DP4, DP5, DP1이다.
- 운영 화면 이름은 `메뉴판 1`~`메뉴판 4`, `카운터 광고`이므로 마이그레이션은 이름을 덮어쓰지 않는다.
- 현재 운영 TV 이미지 행은 0건이며, 이미지 파일은 DB와 별도 저장소에 있다. SQL은 파일을 복사하거나 이미지 행을 만들지 않는다.
- `tv_screens.sync_group`는 양쪽에 이미 있으며, 최신 Drizzle 스키마에는 동기화 그룹 외래키가 없다. 추가 FK나 기본 그룹을 만들지 않는다.

## 적용 파일과 순서

1. 운영 DB 백업을 먼저 수행한다. 최소한 `tv_screens`, `tv_images`, `tv_image_events`, `tv_qr_auth_code_state` 데이터와 구조를 보관하고, 운영 DB 전체 백업을 권장한다.
2. `20261127_tdktv_production_preflight.sql` 실행. 첫 결과가 `TDK_POS`, 기존 매핑이 정확한지 확인한다. DP 코드 충돌 조회는 0행이어야 한다. 화면 수가 5가 아니거나 매핑이 다르면 중단한다.
3. `20261127_tdktv_production_schema.sql` 실행. MariaDB DDL은 암묵적 커밋을 할 수 있어 트랜잭션 롤백으로 되돌아간다고 가정하지 않는다. `ADD COLUMN IF NOT EXISTS`를 지원하는 MariaDB 버전이 필요하다. 버전이 불명확하거나 지원하지 않으면 실행하지 말고 `SHOW CREATE TABLE`과 버전을 재검토한다.
4. `20261127_tdktv_production_postcheck.sql` 실행. DP 매핑 오류 조회는 0행이어야 하고, TV 화면 ID·이름·이미지·이벤트·인증번호 행 개수가 사전 값과 맞는지 확인한다.

마이그레이션은 재실행을 고려해 컬럼 추가에 `IF NOT EXISTS`, 테이블 생성에 `IF NOT EXISTS`를 사용한다. 코드 변경은 기존 ID/코드/목적이 사전 조건과 일치할 때만 적용된다. unique 코드 인덱스 충돌은 SQL 오류로 표시된다. DDL 구문 오류나 코드 변경 도중 중단되면 파일 전체를 무조건 재실행하지 말고 postcheck와 스키마 조회로 실제 적용 상태를 확인한 뒤 진행한다.

## 변경 범위

- `tv_screens`: 기본 `FADE`, 배치 순서·좌표 컬럼을 추가하고 기존 행의 `code`만 DP 코드로 바꾼다. 기존 `screen_id`, 이름, 목적, 이미지 연결, 화면 재생 설정을 유지한다.
- `tv_sync_groups`, `tv_business_notice`: 개발 DB 정의에 맞춰 빈 TV 전용 테이블로 생성한다. 기본 동기화 그룹이나 안내문 레코드는 만들지 않는다.
- POS/QR/직원/결제/세션 테이블은 변경하지 않는다.
- 마이그레이션은 TV 이미지 영구 파일 볼륨을 구성하지 않는다. 운영에 이미지가 없어도 실제 사용 전 별도 이미지 업로드와 지속 저장소 구성이 필요하다.

## 복구

화면 코드 변경만 되돌릴 때는 각 DP 코드가 아직 유일하고 정확한 화면 ID에 붙어 있는지 확인한 뒤 다음 SQL을 개별 실행한다.

```sql
USE TDK_POS;
UPDATE tv_screens SET code='AD-01' WHERE screen_id=5 AND code='DP1' AND purpose='ADVERTISEMENT';
UPDATE tv_screens SET code='MENU-01' WHERE screen_id=1 AND code='DP2' AND purpose='MENU';
UPDATE tv_screens SET code='MENU-02' WHERE screen_id=2 AND code='DP3' AND purpose='MENU';
UPDATE tv_screens SET code='MENU-03' WHERE screen_id=3 AND code='DP4' AND purpose='MENU';
UPDATE tv_screens SET code='MENU-04' WHERE screen_id=4 AND code='DP5' AND purpose='MENU';
```

추가한 컬럼·테이블은 이 마이그레이션 이후 TV 관리 데이터가 입력될 수 있으므로 자동 DROP하지 않는다. 완전 복구가 필요한 경우 백업과 현재 사용 여부를 검토하고 별도 승인된 절차로 처리한다.

## 검증 및 한계

운영·개발 DB 비교는 `information_schema`와 SELECT만으로 수행했다. 이 작업에서 NAS 배포는 수행하지 않았다. TV 이미지 영구 볼륨, Caddy 경로, TV 공개 코드 배포는 별도 배포 준비 단계에서 확인해야 한다.

### 사용자 제공 운영 적용 결과 (2026-11-27)

사용자가 phpMyAdmin에서 `TDK_POS`에 마이그레이션 SQL을 직접 실행했다. 제공된 실행 결과에서 `ALTER TABLE`과 두 `CREATE TABLE`에 오류가 없었고 화면 코드 변경 5건은 각각 1행에 적용됐다. 적용 후 확인 결과는 다음과 같다.

- 화면 ID 1~5의 코드는 각각 `DP2`, `DP3`, `DP4`, `DP5`, `DP1`이며 기존 이름·용도는 유지됐다. 매핑 오류 조회는 0행이다.
- 새 화면 컬럼 4개와 `tv_sync_groups`, `tv_business_notice`의 컬럼이 확인됐다. 기본값은 화면 전환 `FADE`, 배치 순서 `1`, 좌표 `0`이다.
- `tv_screens.code`의 고유 인덱스와 두 새 테이블의 기본키가 확인됐다.
- 행 수는 적용 전후 `tv_screens=5`, `tv_images=0`, `tv_image_events=0`, `tv_qr_auth_code_state=1`로 동일하다. 화면별 이미지 행 수도 모두 0이다.

따라서 제공된 SQL 결과 기준으로 스키마 및 데이터 보존 확인은 통과했다. 실제 TV 화면 접근·재생, 이미지 파일 저장, NAS 배포는 이 SQL 검사에 포함되지 않는다. 백업 수행 여부는 제공된 결과로 확인되지 않았다.
