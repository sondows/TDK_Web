# TDKON 긴급 복구 4/5 — NAS 배포 준비 및 안전성 검증

기준일: 2026-11-22 (KST). 1~3단계 근거는 `20261122-qr-session-schema-review.md`, `20261122-emergency-recovery-stage-02.md`, `20261122-emergency-recovery-stage-03.md`의 실제 내용을 다시 확인했다. 이번 단계에서는 애플리케이션 코드, 운영 DB 데이터, NAS, Docker, Caddy, 운영 QR 세션 및 운영 환경변수를 변경하지 않았다. 로컬 변경은 계획 문서와 이 보고서뿐이다.

## A. NAS 실행 상태와 장애 증거

| 항목 | 상태 | 근거 |
|---|---|---|
| SSH 서비스·포트 | 확인됨 | `192.168.0.83:22`가 응답하나 명시 계정 `sondows`의 비대화형 인증은 `Permission denied (publickey,password,keyboard-interactive)`였다. 비밀번호 추측은 하지 않았다. |
| 컨테이너 이름/ID, 이미지 ID·생성 시각 | 미확인 | SSH 인증 실패. `tdk-pos:1.0.0`은 재사용되는 태그이므로 실행 이미지 식별자가 아니다. |
| NAS Git 커밋, 앱 빌드 ID | 미확인 | 현재 Dockerfile에 Git revision label이 없다. `/app/.next/BUILD_ID`를 읽더라도 별도의 Git 매핑 없이는 커밋을 증명하지 못한다. |
| POS/HOS/8T/QRS 장애 로그 | 미확인 | 11월 21~22일 앱·Caddy 로그에 접근하지 못했다. 과거 HOS 영문 오류 표시는 구 소스의 흔적일 뿐 실행 커밋의 증거가 아니다. |

배포 스크립트 `deploy.bat`에는 `sondows@192.168.0.83`, SSH 22 기본 포트, NAS 소스 경로 `/volume1/TDK-POS/tdk-pos`, Compose 서비스 `tdk-pos`, 예상 컨테이너명 `tdk-pos-tdk-pos-1`이 적혀 있다. 이는 **스크립트 설정**이며 현재 NAS 실측값이 아니다. NAS 관리 화면, 실제 SSH 키 등록 상태, Caddy의 현재 설정도 확인하지 못했다.

### NAS 담당자가 공유할 읽기 전용 결과

아래는 NAS에서 실행할 조사 명령이다. 출력의 토큰·쿠키·고객정보는 공유 전에 제거한다. 전체 환경변수나 `.env.production` 내용은 출력하지 않는다.

```sh
cd /volume1/TDK-POS/tdk-pos || exit 1
pwd -P
git -C /volume1/TDK-POS rev-parse HEAD
git -C /volume1/TDK-POS status --short -- tdk-pos
sudo docker compose ps tdk-pos
APP=$(sudo docker compose ps -q tdk-pos)
test -n "$APP" || exit 1
sudo docker inspect --format '{{.Id}} {{.Image}} {{.Created}} {{.Config.Image}}' "$APP"
OLD_ID=$(sudo docker inspect --format '{{.Image}}' "$APP")
sudo docker image inspect "$OLD_ID" --format '{{.Id}} {{.Created}} {{json .Config.Labels}}'
sudo docker exec "$APP" sh -c 'cat /app/.next/BUILD_ID'
sudo docker exec "$APP" sh -c 'printf "DB_NAME=%s\n" "${DB_NAME-}"; case "${QR_PUBLIC_BASE_URL-}" in "") echo QR_PUBLIC_BASE_URL=UNSET;; "https://tdkon.myasustor.com") echo QR_PUBLIC_BASE_URL=CANONICAL;; *) echo QR_PUBLIC_BASE_URL=INVALID;; esac; printf "NODE_ENV=%s\n" "${NODE_ENV-}"'
sudo docker logs --timestamps --since '2026-11-21T00:00:00+09:00' --until '2026-11-23T00:00:00+09:00' "$APP" > /path/to/protected-log-copy
```

마지막 로그 명령의 출력 위치는 담당자가 권한이 제한된 경로로 정해야 한다. 이 단계에서는 실행하지 않았다. 로그에서 POS 렌더 실패, `GET /api/hos/tables` 503, 8T 취소, `/q/{identifier}` 접속, `TypeError: immutable`, MariaDB code/errno/SQLSTATE의 시각을 이미지 생성·컨테이너 생성·배포 시각과 대조해야 한다. Caddy가 컨테이너인지 NAS 서비스인지도 실측 후 해당 로그를 확인한다.

## B. Git 및 정확한 배포 대상

- 로컬 브랜치 `main`, HEAD `b9d7ab256964218eb88642954f5a8d4c20bc3d8f`. 로컬 추적 `origin/main`은 같은 SHA(`0 0`)이나 원격을 새로 fetch한 결과는 아니다. 스테이징된 `tdk-pos`/`deploy.bat` 파일은 없다. 저장소 상위의 다른 디렉터리에도 다수의 기존 변경이 있어 손대지 않았다.
- **필수 앱 변경:** `src/app/q/[identifier]/route.ts`의 새 302 응답·쿠키 처리와 오류 안내용 `src/app/qrorder/[notice]/page.tsx`; `src/lib/admin-qr-export.ts`; `src/app/api/admin/qr-codes/[qrCodeId]/{image,png}/route.ts`; `src/app/api/admin/qr-codes/export/route.ts`; `src/app/api/qr/table-order-link/route.ts`.
- **테스트/설정 예시/문서:** `src/lib/admin-qr-export.test.mjs`, `scripts/verify-qr-cancellation-scope.cjs`, `scripts/verify-qr-entry-development.cjs`, `.env.production.example`, `PLANS.md`, 1~4단계 보고서. 테스트 스크립트는 운영 런타임에 필요한 파일이 아니며 `Dockerfile`의 최종 런타임 복사 대상도 아니다. 실제 운영 `.env.production`은 Git/Docker 빌드 컨텍스트에서 제외된다.
- 3단계 전에 이미 `src/app/q/[identifier]/route.ts`, `src/app/qrorder/[notice]/page.tsx`, `src/lib/admin-qr-export.test.mjs`에 미커밋 수정이 있었다. 전체 차이를 릴리스 변경으로 검토해야 하며, 다른 사용자 변경을 무심코 덮어쓰거나 제외해서는 안 된다.
- **새로 발견한 필수 수정 후보, 아직 변경하지 않음:** `src/app/q/join/[token]/route.ts`의 초대 합류 쿠키 응답. 아래 C절 참조. 이 파일을 고치고 별도 회귀 테스트를 통과하기 전에는 현재 작업 트리를 배포 대상으로 확정할 수 없다.
- NAS 실행 커밋이 `b9d7ab2`보다 오래됐다면, 이번 미커밋 파일 외에 그 사이의 **모든 커밋 차이**가 배포된다. `git diff <NAS_SHA>..<RELEASE_SHA> -- tdk-pos`와 마이그레이션 목록을 검토하기 전에는 배포 범위를 확정할 수 없다.

### 실제 배포 스크립트의 범위 위험

루트 `deploy.bat`는 `git add -A -- deploy.bat tdk-pos`와 `git commit --only -- deploy.bat tdk-pos`를 실행하고, `main`을 push한 뒤 NAS에서 fetch/pull, `sudo docker compose build`, `up --force-recreate`를 수행한다. 현재 작업 트리에서 임시 Git 인덱스·임시 객체 디렉터리로 **실제 스테이징을 건드리지 않고** 같은 경로 추가와 `git diff --cached --check`를 재현한 결과 검사 종료 코드는 0이었다. 다만 이 범위는 3단계 앱 수정만이 아니라 미커밋 테스트 스크립트, 과거 보고서, 계획 문서까지 모두 포함한다. 이전 `Validate staged deployment paths` 실패의 당시 원인은 미확인이다. 검사를 우회하거나 `deploy.bat`를 현 상태 그대로 실행하면 안 된다.

`deploy.bat`의 `tdk-pos:backup-before-deploy` 태그는 매번 덮어쓸 수 있고 영구 이미지 아카이브가 아니다. 자동 롤백 분기는 `compose up` 실패만 다루며, 컨테이너는 뜨지만 POS/HOS/QRS가 실패하는 경우에는 자동 롤백하지 않는다. `compose ps`/healthcheck만으로 업무 흐름의 정상 여부도 알 수 없다. 스크립트의 현재 백업·롤백 방식은 이 배포의 안전성 근거로 충분하지 않다.

현재 `docker-compose.yml`은 `network_mode: host`로 앱의 3000 포트를 NAS 호스트에서 사용하고, 저장소의 Caddy 예시는 `192.168.0.83:3000`으로 역방향 프록시한다. `DEPLOYMENT.md`의 포트 매핑 설명은 현재 Compose와 일치하지 않는다. 실제 NAS Caddy 설정과 3000 포트의 외부 노출 상태는 미확인이다.

## C. 운영 호환성·보안 검토

### 스키마와 데이터

- 운영 DB `TDK_POS`에 **읽기 전용**으로 재접속해 `SELECT DATABASE()`를 확인했다. `qr_sessions.table_id`는 `bigint(20) unsigned NULL`; 인덱스 `idx_qr_sessions_table_status(table_id,status)`와 `fk_qr_sessions_dining_table → dining_tables(table_id)`가 존재한다. 추가 QR 스키마 마이그레이션은 필요하지 않다. `20261122_qr_sessions_table_id.sql`을 재실행하면 안 된다.
- 3단계 앱 diff는 QR 세션 진입 응답과 QR 공개 URL 생성에 한정된다. 테이블 세션, QR/일반 주문, 결제, 취소, 초대 레코드의 SQL/스키마는 바꾸지 않았다. 배포 후 QRS 접속은 원래 설계대로 새 QR 세션을 만들 수 있고 주문은 데이터를 쓰므로, 배포 후 실사용 검증 시 생산 데이터 변경을 별도로 승인·계획해야 한다.
- 기존 QR 식별자·토큰 형식과 `/q/{identifier}` 경로는 그대로다. 기존 스티커에 이미 사설 IP가 인코딩돼 있다면 새 코드 배포만으로 인쇄물이 바뀌지 않는다. 실제 스티커 한 장의 QR 페이로드 확인이 필요하며 재발급/폐기는 별도 작업이다.

### QR 쿠키·초대: 배포 차단 결함

- 3단계의 `/q/{identifier}`는 `new Response(null, {status:302, headers:{Location, "Set-Cookie"}})`를 반환한다. `qrSessionCookieAttributes`는 `Path=/`, `Max-Age=21600`(6시간), `HttpOnly`, `SameSite=Lax`를 부여하고 `x-forwarded-proto=https` 또는 HTTPS request URL이면 `Secure`를 부여한다. TEST HTTP 통합 테스트에서 쿠키·주문·세션 종료 후 접근 차단이 통과했다. 운영 Caddy가 실제로 HTTPS 프록시 헤더를 전달하는지는 미확인이다.
- `.env.production.example`의 `SESSION_COOKIE_SECURE=false`는 QR 쿠키와 별개인 POS 직원 세션 쿠키의 `Secure`를 끄는 명시 설정이다(`src/lib/auth.ts`). 실제 NAS 값은 미확인이다. POS의 LAN HTTP/공개 HTTPS 정책과 함께 운영값을 확인해야 하며, 예시 파일의 값을 그대로 운영 설정에 복사해서는 안 된다.
- 쿠키를 종료 시 즉시 지우는 일반 QRS 경로는 확인되지 않았다. 세션 상태가 `CLOSED`가 되면 서버의 토큰 조회가 거부하며, 브라우저 쿠키는 Max-Age까지 남을 수 있다. 이는 3단계 수정에 따른 새 정책이 아니고 실제 쿠키 삭제 동작을 검증했다는 뜻도 아니다.
- **확인된 소스 결함:** `/q/join/[token]`은 유효한 초대를 DB 트랜잭션에서 사용하고 QR 세션을 삽입한 다음 `Response.redirect(...).headers.append("Set-Cookie", ...)`를 실행한다. 현재 Node 22에서 이 헤더 조작은 `TypeError: immutable`을 발생시킨다. 해당 route의 `catch`는 `/qrorder/invite-invalid`로 보내므로, 합류 세션이 커밋됐는데 새 고객 쿠키가 없는 상태가 될 수 있다. 3단계 수정과 같은 유형이며 실제 초대 API 통합 테스트는 아직 하지 않았다. **초대 합류 응답을 새 302 Response로 고치고 TEST에서 초대 생성·합류·쿠키·중복·만료·취소를 검증하기 전에는 배포 보류.**
- `src/app/api/qr/order-invites/route.ts`는 초대 URL `/q/join/{token}`을 `request.url` origin으로 만든다. 내부 IP로 접속한 고객이 링크를 공유하면 내부 IP가 들어갈 수 있다. 고정 스티커 URL 수정 범위 밖이므로 이번 단계에서 변경하지 않았다. 운영 공개 URL 정책과 개발 환경 호환성을 정해 검증해야 한다.
- QR 만료는 서버의 ACTIVE 상태·스티커/테이블 상태·토큰 시간·연결된 테이블 세션/최초 승인 주문 시간을 확인한다. 취소·결제·테이블 종료는 QR 세션을 CLOSED 처리하고 초대를 회수하는 현재 로직을 유지한다. 운영 활성 세션과 실제 합류 흐름은 미검증이다.

### POS/HOS/8T

- 이번 앱 diff에 POS 로그인/렌더/테이블 조회/주문내역, HOS 로그인/목록/QR 대기·승인·거절·갱신, `table-cancellations` API, 일반 주문·결제 코드 변경은 없다. 공유 QR 현황 SQL은 1단계에서 양쪽 DB에 성공했으며, 4단계에서 취소 SQL 범위·PENDING 차단·다른 테이블 보호·롤백을 TEST에서 다시 통과했다.
- Dockerfile의 `NEXT_PUBLIC_DEVICE_AGENT_URL`은 **빌드 인자**이고 현재 Compose에는 별도 인자 지정이 없어 기본값 `http://127.0.0.1:5168`을 사용한다. NAS 이전 이미지가 다른 인자로 빌드됐는지는 미확인이다. POS 프린터/금전함 연동에 영향이 있을 수 있으므로 이전 이미지의 실제 브라우저 동작과 신규 빌드 설정을 비교한다.
- 과거 POS/HOS 503/8T 실패의 NAS 오류 로그와 실행 버전을 확보하지 못했다. 이 장애가 해결됐다고 단정할 수 없다. 인증된 POS/HOS API와 PIN 포함 취소 API 전체 경로는 아직 테스트하지 못했다.

## D. 현재 소스 검증 결과

| 검사 | 결과 |
|---|---|
| TypeScript `tsc --noEmit` | 통과 |
| 변경 앱/검증 스크립트 ESLint | 통과(오류 0) |
| 관련 단위 테스트 10개 파일 | 28/28 통과 (`node --experimental-strip-types --test ...`). 최초 `--experimental-strip-types` 없이 실행한 시도는 Node 22의 `.ts` import 오류로 실패했고 올바른 실행 옵션으로 재검증했다. |
| TEST DB 취소 범위·롤백 | 통과; 테스트 트랜잭션 최종 롤백 |
| TEST HTTP QR 최초 진입·주문·종료 | 통과; 고유 테스트 행 정리, 기존 개발 서버 유지 |
| Node의 초대 합류 응답 패턴 | `TypeError: immutable` 재현; **미수정** |
| Next.js 16.3.5 프로덕션 빌드 | 종료 코드 0. 기존 `menu-image-storage.ts` 동적 파일 경로 추적 경고 2건 |
| 실제 NAS/브라우저/인증된 POS·HOS/8T 전체 API | 미검증 |

## E. 5단계 운영 배포 순서와 롤백 계획

아래는 **실행하지 않은 계획**이다. 실제 명령의 컨테이너 ID, 백업 위치, NAS Git SHA, 운영 환경 설정은 A절의 실측 결과로 먼저 채워야 한다. 현 `deploy.bat`의 자동 경로는 배포 범위와 백업을 충분히 통제하지 못하므로 그대로 사용하지 않는다.

### 선행 게이트

1. 초대 합류의 불변 헤더 결함을 수정하고, TEST에서 초대 발급→합류 쿠키→주문 조회, 재사용·만료·회수, 기존 세션 보호를 검증한다. 초대 URL origin 정책을 결정한다.
2. NAS 실행 컨테이너/불변 이미지 ID/생성 시각/커밋 또는 검증 가능한 빌드 매핑과 11월 21~22일 관련 오류 로그를 확보한다. NAS 커밋과 릴리스 커밋 사이의 **전체** 변경을 검토한다. POS/HOS/8T의 계속되는 오류가 있으면 해당 원인을 분리해 해결한다.
3. NAS Compose·Caddy 실제 경로, `DB_NAME=TDK_POS`, `NODE_ENV=production`, 공개 QR 주소 설정 상태, HTTPS 프록시 헤더, QR `Secure` 쿠키와 직원 `SESSION_COOKIE_SECURE` 정책, POS Device Agent 빌드 인자를 확인한다. 비밀 값은 출력하지 않는다.
4. 승인된 파일만 포함한 릴리스 커밋을 확정한다. `git diff --check`, 전체 대상 diff, NAS 쪽 미커밋 상태, DB 마이그레이션 없음, `.dockerignore`의 `.env*` 제외를 점검한다. `origin/main`을 최신 fetch한 뒤 원격 추가 변경이 없는지도 확인한다.
5. 현재 실행 이미지의 불변 ID를 기록하고, 덮어쓰지 않는 이름으로 태그한 뒤 보호된 NAS 위치에 `docker save` 아카이브를 만든다. 파일 크기·SHA-256·아카이브 읽기와 충분한 여유 공간을 확인한다. 기존 `.env.production`과 Compose 설정도 권한 600/700의 보호 경로에 복사하고 복구 방법을 확인한다. 백업 파일 내용은 출력하지 않는다.
6. 기존 `deploy/db-backup/backup-mariadb.sh` 설치·설정·최근 `TDK_POS` 백업을 NAS에서 확인한다. 필요하면 승인 후 사전 백업을 실행하고 `.sql.gz`의 `gzip -t`, `.sha256` 검증과 격리 DB 복원 기록을 확인한다. 실제 설치 여부와 복원 가능성은 현재 **미확인**이다. DB 백업을 운영에 그대로 복원하는 방식은 롤백 계획이 아니다.
7. 릴리스 소스에서 TypeScript, ESLint, QR/초대/취소 테스트와 프로덕션 빌드·Docker 이미지 빌드를 다시 통과시키고, NAS 커밋이 승인 SHA인지 확인한다. 여기까지 완료한 뒤 5단계의 명시적 운영 승인으로 넘어간다.

### 승인 후에만 실행할 배포 명령의 뼈대

```sh
cd /volume1/TDK-POS/tdk-pos || exit 1
test "$(git -C /volume1/TDK-POS rev-parse HEAD)" = '<APPROVED_RELEASE_SHA>' || exit 1
APP=$(sudo docker compose ps -q tdk-pos)
test -n "$APP" || exit 1
OLD_ID=$(sudo docker inspect --format '{{.Image}}' "$APP")
# 위 ID의 이미지 아카이브·설정·DB 백업 검증이 끝난 경우에만 계속한다.
sudo docker compose build tdk-pos
NEW_ID=$(sudo docker image inspect tdk-pos:1.0.0 --format '{{.Id}}')
test "$NEW_ID" != "$OLD_ID" || exit 1
sudo docker compose up -d --no-deps --no-build --force-recreate tdk-pos
sudo docker compose ps tdk-pos
sudo docker inspect --format '{{.Image}} {{.State.Status}} {{.State.Health.Status}}' "$(sudo docker compose ps -q tdk-pos)"
```

이미지 백업 명령은 경로·권한·공간을 실측한 후 `sudo docker image tag "$OLD_ID" "tdk-pos:rollback-<RELEASE_ID>"`, `sudo docker save -o '<PROTECTED_BACKUP_DIR>/app.tar' "$OLD_ID"`, `sha256sum`, `tar -tf` 순으로 준비한다. 같은 이름의 롤백 태그를 재사용하지 않는다. `docker compose build`는 현재 컨테이너를 교체하지 않지만 이미지 태그를 갱신한다. `up --force-recreate` 동안 짧은 앱 중단과 진행 중 요청 실패가 가능하다. Caddy 및 DB는 변경하지 않는다.

배포 직후에는 새 컨테이너 이미지 ID가 `NEW_ID`인지 대조하고 앱 로그·Caddy 경로·공개 HTTPS를 확인한다. 인증된 POS/HOS의 로그인·테이블 목록·QR 현황·주문내역, QR 주문 승인/거절, 고객 QR 접속·쿠키의 `Secure/HttpOnly/SameSite`·주문·만료·초대 합류, QR PNG/SVG/ZIP 페이로드를 검증한다. 주문·취소·결제·QR 스캔처럼 운영 DB를 쓰는 실습은 5단계에서 명시적으로 승인된 테스트 데이터와 정리 절차가 있을 때만 수행한다. 단순 healthcheck 성공을 업무 정상으로 취급하지 않는다.

### 오류 시 롤백

- 이미지 **빌드 실패 전/중**: 기존 컨테이너가 그대로라면 교체하지 않고 오류를 조사한다.
- 컨테이너 시작 실패, POS/HOS/QRS 오류, 쿠키/QR URL 오류, 예상 외 DB 오류: 추가 트래픽과 쓰기 테스트를 중단하고 이전 이미지 ID/아카이브를 확인한다. 이전 이미지를 `tdk-pos:1.0.0`에 다시 태그한 뒤 `sudo docker compose up -d --no-deps --no-build --force-recreate tdk-pos`로 앱 컨테이너만 복구한다. 기존 ID가 로컬에 없다면 보호된 `app.tar`을 `docker load -i`로 로드한 뒤 ID를 확인한다. 이전 Compose/.env 설정이 바뀌었다면 저장본을 사용하되 승인된 운영 절차로만 복원한다.
- 롤백 후 이미지 ID, 앱 로그, POS/HOS/QRS의 안전한 확인 항목을 다시 점검한다. 운영 주문·결제·QR 세션 데이터는 삭제·초기화하거나 오래된 DB 백업으로 덮어쓰지 않는다. 새 코드가 남긴 데이터와 구 코드의 호환성은 NAS 현재 버전을 확인한 뒤 사전에 평가한다.

## F. 5단계 진행 판단 — **배포 보류**

배포 차단 근거는 세 가지다. **(1)** 초대 고객 합류가 동일한 `TypeError: immutable` 결함을 가진 상태다. **(2)** NAS 실행 이미지·커밋·과거 POS/HOS/8T 로그와 실제 환경변수를 확보하지 못했다. **(3)** 이전 이미지의 보존·아카이브·DB 복원 가능성이 확인되지 않았고 `deploy.bat`는 현재 모든 `tdk-pos` 미커밋 파일을 자동 포함한다. 로컬 빌드와 개발 테스트 통과는 이 세 조건을 대체하지 못한다.

다음 단계에서 차단 항목을 해소하고, 승인 대상 커밋·NAS 이미지 ID·백업 위치·검증 범위·롤백 명령을 채운 구체적인 배포안에 대해 사용자 명시 승인을 받은 뒤에만 운영 적용한다. 운영 DB 마이그레이션과 `/tdkqrs/` 경로 전환은 이 복구 배포 대상이 아니다.
