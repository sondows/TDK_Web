# TDKON 긴급 복구 5단계 — 운영 배포 전 최종 사전점검

기준일: 2026-11-22 (KST). 1~4.5단계 보고서, 현재 소스, `deploy/EMERGENCY-RELEASE-4_5.md`와 실제 배포 스크립트를 대조했다. **결론: 배포 보류.** 이 단계에서 운영 DB, NAS 파일·이미지·컨테이너, Caddy, 운영 QR/주문 데이터, Git 인덱스·커밋·원격을 변경하지 않았다. 로컬 테스트는 `TDK_POS_TEST`의 고유 임시 행을 정리하거나 트랜잭션을 롤백했다.

## A. NAS 접근

| 항목 | 상태 | 증거와 한계 |
|---|---|---|
| 접속 설정 | 확인됨 | 현재 `deploy/release.ps1`은 `sondows@192.168.0.83`, 기본 SSH 22번, `BatchMode=yes`를 사용한다. `ssh -G`도 같은 사용자·주소·포트와 공개키 인증 가능 상태를 표시했다. 별도 `~/.ssh/config`는 없다. |
| 연결·인증 | 확인됨 | 승인된 설정으로 읽기 전용 `ssh -o BatchMode=yes -o NumberOfPasswordPrompts=0 -o StrictHostKeyChecking=yes -o ConnectTimeout=10 ... 'id -un'`을 한 번 시도했다. 기본 샌드박스에서는 연결 권한 거부, 허용된 네트워크 경로에서는 NAS가 `Permission denied (publickey,password,keyboard-interactive)`를 반환했다. 22번 서비스 응답 이후 인증 단계에서 실패했다. |
| 인증 실패의 정확한 원인 | 미확인 | 이 PC의 기본 `id_ed25519`·`id_rsa` 파일이 없고 SSH agent 소켓도 없다. 다른 승인 키·NAS 계정 정책·공개키 등록 상태는 확인할 수 없으므로 특정 원인 하나로 단정하지 않는다. 비밀번호/개인키 내용은 조회하거나 출력하지 않았다. |

NAS 담당자는 SSH 서비스·포트, `sondows` 계정의 SSH 허용 상태, 계정의 `authorized_keys`와 권한, 이 PC에서 사용할 **기존 승인된 개인키 경로**를 확인해야 한다. 키를 새로 등록하거나 NAS SSH 설정을 바꿔야 한다면 변경 대상과 방법을 먼저 승인받아야 한다. 기존 승인 키가 있다면 `ssh -i <승인된_키_경로> -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -p 22 sondows@192.168.0.83 'id -un'`으로 읽기 전용 확인을 다시 할 수 있다. 키 내용이나 비밀번호는 보고서로 공유하지 않는다.

## B. 운영 실행 버전

| 항목 | 상태 | 결과 |
|---|---|---|
| 운영 컨테이너 ID·생성시각, 실행 이미지 불변 ID·태그·생성시각, 상태·재시작 횟수·헬스 | 미확인 | SSH 인증 실패. `tdk-pos:1.0.0`은 Compose 설정의 재사용 가능 태그일 뿐, 실행 이미지 ID가 아니다. |
| NAS Git HEAD, 이미지 revision label, `/app/.next/BUILD_ID`, 실제 배포 이력 | 미확인 | NAS 조회 불가. 기존 Dockerfile은 Git revision label을 만들지 않아 BUILD_ID만으로 커밋을 증명할 수 없다. |
| 로컬 기준 | 확인됨 | `main` HEAD와 로컬 추적 `origin/main`은 `b9d7ab256964218eb88642954f5a8d4c20bc3d8f`. 원격을 새로 fetch한 사실은 없다. 3·4.5단계 수정은 미커밋이라 이 HEAD가 릴리스 후보 커밋은 아니다. |

NAS 접속이 되면 다음 **읽기 전용** 명령으로 실행 객체를 먼저 고정한다. 출력에 비밀값이 나오지 않는 항목만 공유한다.

```sh
cd /volume1/TDK-POS/tdk-pos || exit 1
git -C /volume1/TDK-POS rev-parse HEAD
git -C /volume1/TDK-POS status --short -- tdk-pos
sudo -n docker compose ps tdk-pos
APP=$(sudo -n docker compose ps -q tdk-pos); test -n "$APP" || exit 1
sudo -n docker inspect --format '{{.Id}} {{.Image}} {{.Created}} {{.State.Status}} {{.RestartCount}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$APP"
OLD_ID=$(sudo -n docker inspect --format '{{.Image}}' "$APP")
sudo -n docker image inspect "$OLD_ID" --format '{{.Id}} {{.Created}} {{json .RepoTags}} {{json .Config.Labels}}'
sudo -n docker exec "$APP" sh -c 'cat /app/.next/BUILD_ID; printf "DB_NAME=%s\n" "${DB_NAME-}"'
```

이미지 label이 없으면 NAS Git HEAD와 실행 이미지의 대응은 별도 배포 기록/빌드 산출물로 검증해야 한다. 이미지가 건강해도 POS/HOS/QRS 업무 동작이 건강하다는 증거는 아니다.

## C. 11월 21~22일 장애 로그

| 대상 | 상태 | 판단 |
|---|---|---|
| POS 메인 렌더링·인증·DB 연결 | 미확인 | 운영 앱/Caddy 로그 미확보. |
| HOS 테이블 API 503·QR 현황 SQL | 미확인 | 운영 요청 시각·MariaDB 오류 번호·실행 이미지가 없다. |
| 8T 취소·미처리 주문 검사·트랜잭션 롤백 | 미확인 | 실제 취소를 재실행하지 않았다. TEST에서 취소 SQL 범위·PENDING 차단·롤백만 통과했다. |
| 일반 QR 최초 접속·초대 합류 | 운영 현상 미확인 | 로컬에서 `Response.redirect`의 불변 헤더 오류를 재현·수정하고 TEST 통합 검증은 통과했지만, 당시 운영 로그와 실행 버전은 없다. |

NAS에서 `sudo -n docker logs --timestamps --since '2026-11-21T00:00:00+09:00' --until '2026-11-23T00:00:00+09:00' "$APP"`와 실제 Caddy 로그를 조회해 POS/HOS/8T/QRS 요청 시각, `Unknown column`/1054, `TypeError: immutable`, DB/인증 오류를 이미지·컨테이너 생성 시각과 대조해야 한다. 공유 전 쿠키·세션/초대 토큰·고객 정보는 마스킹한다. 로그가 보존되지 않았다면 원인 미확인으로 유지하고 재현 가능한 **개발 환경** 로그를 별도로 수집한다.

## D. 이미지·설정 백업과 롤백

| 항목 | 상태 | 점검 결과 |
|---|---|---|
| 기존 실행 이미지 ID·백업 아카이브·SHA-256·저장 공간 | 미확인 | NAS 접근 불가. `nas-release.sh`는 릴리스 SHA별 `/volume1/tdk-pos-release-backups/<SHA>/old-image.tar`와 `.sha256`, `old-image-id`를 만들고 검증하도록 작성됐으나 **이번 단계에서 생성하지 않았다**. 기존 백업 존재도 확인 못했다. |
| Compose/.env 백업과 현재 컨테이너 설정의 일치 | 미확인 | 스크립트는 배포 시점 파일을 복사한다. 파일이 컨테이너 생성 후 바뀌었다면 복사본이 실제 실행 설정과 다를 수 있다. Docker inspect의 마운트·네트워크·재시작 정책·설정 생성 시각을 비교해야 한다. 비밀값은 출력하지 않는다. |
| 이미지 복원·태그 충돌·DB/볼륨/Caddy 보존 | 정적 검토됨 | `rollback <SHA>`는 아카이브 체크섬 확인→필요 시 `docker load`→기존 이미지 ID를 `tdk-pos:1.0.0`에 태그→백업 Compose/.env 복사→앱 서비스만 재생성→실행 이미지 ID와 health 비교 순서다. 스크립트상 볼륨·DB·Caddy 삭제 명령은 없다. 태그는 바뀌지만 복원 성공 여부는 미검증이다. |
| 실제 복원, 자동/수동 롤백 | 미검증 | 로컬 Docker CLI가 없고 NAS SSH가 거부돼 격리 Docker 시험과 NAS 시험을 수행하지 못했다. 셸 구문 검사만 통과했다. 시작/health 실패 시 자동 복구 분기는 있지만 기능 장애는 수동 판단·롤백이 필요하다. 복구 자체가 실패하면 NAS 현장 조사와 기존 아카이브·설정 보존이 우선이다. |

배포 전 NAS에서 실행 이미지 ID, 아카이브 존재·`sha256sum -c`, `tar -tf`, 여유 공간, Compose/.env 보호된 백업, `sudo -n` 및 Compose 버전, `TDK_POS` 백업 체크섬과 격리 복원 기록을 확인해야 한다. **운영 이미지 아카이브 생성 및 NAS 롤백 시험은 NAS 쓰기 작업**이므로 별도 승인 전에는 수행하지 않는다. 정적 검토만으로 복구 가능하다고 판정할 수 없다. 롤백 후 NAS Git checkout과 실행 이미지는 서로 다른 버전일 수 있어 다음 배포 전 재대조가 필요하다.

## E. 릴리스 후보와 검사

**커밋:** 아직 없음. 현재 `main` HEAD는 `b9d7ab...`; 실제 Git 인덱스의 배포 경로 스테이징 파일은 0개다. 로컬 수정 14개와 미추적 파일이 있으며, 저장소의 다른 경로에도 기존 사용자 작업이 있어 보존했다. NAS 기준 SHA 미확인으로 최종 `NAS_BASE..RELEASE_SHA` diff/승인 manifest는 아직 확정할 수 없다.

현재 HEAD 이후 **검토할 19개 경로 후보**(저장소 상대 경로; 운영 `.env.production` 파일은 포함하지 않음):

```text
deploy.bat
tdk-pos/.dockerignore
tdk-pos/.env.production.example
tdk-pos/src/app/api/admin/qr-codes/[qrCodeId]/image/route.ts
tdk-pos/src/app/api/admin/qr-codes/[qrCodeId]/png/route.ts
tdk-pos/src/app/api/admin/qr-codes/export/route.ts
tdk-pos/src/app/api/qr/table-order-link/route.ts
tdk-pos/src/app/q/[identifier]/route.ts
tdk-pos/src/app/q/join/[token]/route.ts
tdk-pos/src/app/qrorder/[notice]/page.tsx
tdk-pos/src/lib/admin-qr-export.ts
tdk-pos/src/lib/qr-order-auth.ts
tdk-pos/src/lib/admin-qr-export.test.mjs
tdk-pos/scripts/verify-qr-cancellation-scope.cjs
tdk-pos/scripts/verify-qr-entry-development.cjs
tdk-pos/scripts/verify-qr-invite-development.cjs
tdk-pos/deploy/release.ps1
tdk-pos/deploy/nas-release.sh
tdk-pos/deploy/EMERGENCY-RELEASE-4_5.md
```

앱 9개 경로에는 일반 QR·초대 리다이렉트/쿠키, 공개 HTTPS QR 주소 및 QR 오류 안내가 있다. `.dockerignore`와 설정 예시, 배포 도구 3개 경로, 테스트 4개 경로가 나머지다. **제외 제안:** `tdk-pos/PLANS.md`, 1~5단계 `checkpoints/` 보고서, 저장소 다른 프로젝트의 미커밋 변경. 이들은 운영 런타임에 필요하지 않다. 최종 릴리스 파일 범위는 NAS 기준 SHA 이후 기존 커밋의 모든 경로도 포함해 검토해야 한다. 예를 들어 임시 비교 기준 `a36b611...`에서 현재 HEAD까지는 `20261122_qr_sessions_table_id.sql` 등 9개 경로가 추가되지만, **NAS 기준이 `a36b611...`이라는 증거는 없다**. 이 SQL이 delta에 있더라도 운영 마이그레이션을 재실행하지 않는다.

| 검사 | 결과 |
|---|---|
| TypeScript `tsc --noEmit` | PASS |
| 변경 앱/테스트 ESLint | PASS, 오류 0 |
| 관련 단위 테스트 10파일 | PASS, 28/28. 공개 QR HTTPS URL·SVG/PNG/ZIP 생성 포함 |
| `TDK_POS_TEST` 일반 QR HTTP 진입·쿠키·주문·종료 | PASS, 임시 행 정리 |
| `TDK_POS_TEST` 초대 합류·해시 토큰·HTTPS 쿠키·주문·재사용·만료/회수/종료/교차 테이블 | PASS, 임시 행 정리 |
| `TDK_POS_TEST` 취소 SQL 범위·PENDING 차단·반복·세이브포인트 | PASS, 트랜잭션 롤백 |
| Next.js 16.3.5 프로덕션 빌드 | PASS, 기존 `menu-image-storage.ts` 동적 경로 추적 경고 2건 |
| PowerShell 파서/POSIX `sh -n` | PASS |
| 현재 작업 트리 `DryRun` | 의도한 **차단**: `Validate staged deployment paths: PASS` 후 미커밋 배포 경로 감지, 종료 코드 1. SSH·NAS·Docker·DB 작업 없음. 4.5단계의 깨끗한 격리 저장소 드라이런은 PASS였으나 이번 단계에는 반복하지 않았다. |
| 실제 Docker 이미지 빌드/복원, 인증된 운영 POS/HOS/8T 전 경로 | 미검증 |

첫 QR 진입 통합 검사 시 기존 Next 개발 서버 때문에 새 서버 시작이 거부됐고, 기존 서버의 `/api/db-test`가 `TDK_POS_TEST`임을 확인한 뒤 같은 검사를 다시 실행해 PASS했다. 테스트 실패로 앱 결함을 단정하지 않았다.

스크립트 정적 점검: `release.ps1`은 승인 SHA=로컬 `main` HEAD, NAS 기준의 조상 관계, 전체 커밋 경로와 정확한 manifest, 임시 인덱스의 `git diff --cached --check`, 배포 경로의 깨끗한 작업 트리를 검사한다. `Deploy`는 원격 main SHA 확인, 동일 SHA 재입력, Device Agent URL을 요구하며 자동 `git add/commit/push`가 없다. NAS helper는 현재 이미지·설정 백업 검증과 후보 빌드를 컨테이너 교체 전에 둔다. 다만 NAS `sudo -n`/공간/이미지 복원 실측과 운영 설정 일치 확인은 미완료다.

**커밋 준비 절차:** 원본 작업 트리는 유지하고 깨끗한 별도 릴리스 체크아웃에서 위 19개 경로의 전체 diff를 검토한다. NAS 기준 SHA를 확보한 뒤 `git diff --name-only <NAS_BASE_SHA> <RELEASE_SHA> --`의 **모든 경로**를 승인 manifest와 비교한다. 커밋·푸시는 이번 단계에서 하지 않는다. `-Mode DryRun`이 실제 후보 SHA와 manifest로 성공하고 운영 백업/복원 근거가 확보돼야 별도 배포 승인을 요청할 수 있다.

## F. QR 초대 URL 정책

- **확인됨 — 현재 구현:** 생성 API는 인증된 QR 고객, 승인된 첫 주문으로 시작된 OPEN 테이블 세션, 현재 정원과 세션 만료를 검사한다. 초대 토큰은 32바이트 난수 기반으로 발급해 DB에는 SHA-256 해시만 저장한다. 초대 만료는 공유 테이블 세션 만료를 따르며 첫 QR 토큰 기준 최대 약 6시간이다.
- **확인됨 — 합류:** 동일 고객의 반복 요청은 기존 세션을 재사용한다. 다른 고객도 같은 초대 URL로 만료·회수·테이블/QR 비활성화·정원에 걸리지 않는 동안 합류한다. 초대 행을 잠그고 정원·현재 QR 링크를 확인해 중복 요청을 직렬화한다. `redeemed_at`은 첫 사용 시각이며 재사용 차단 조건이 아니다. TEST 통합 검사에서 두 고객 재사용과 거부 조건을 확인했다.
- **불일치:** `src/db/schema.ts`의 “Invitation bearer values are one-time” 주석은 구현과 다르다. 이번 단계에서 주석/정책 코드는 바꾸지 않았다. 초대 URL 생성은 요청 origin을 쓰므로 내부 주소에서 발급하면 내부 주소가 공유될 수 있다. 이 주소 정책과 여러 고객 공유 허용 여부도 운영 요구사항 확인이 필요하다.
- **결정 필요:** 초대 URL을 정원까지 여러 고객이 공유하는 현행 정책으로 승인할지, 진짜 1회용으로 바꿀지 결정한다. 후자를 원하면 동시 합류와 중복 접속 설계·테스트를 별도 변경으로 진행해야 한다.

## G. 최종 배포 판단 — **배포 보류**

차단 조건: (1) NAS SSH 인증 실패로 실제 실행 이미지/커밋/11월 21~22일 장애 로그 미확보, 따라서 POS/HOS/8T 운영 원인 미확정; (2) 기존 이미지·Compose/.env·DB 백업과 복원 가능성, 디스크·`sudo -n`·실제 Docker 롤백 미검증; (3) 릴리스 커밋과 NAS 기준 SHA가 없어 최종 diff/승인 manifest 및 깨끗한 체크아웃 드라이런 불가; (4) 초대 재사용·내부 주소 링크 정책과 운영 Caddy HTTPS 헤더/QR 공개 origin/Device Agent URL 값 미확인.

다음 순서로 해소한다. NAS 담당자가 승인된 SSH 키 또는 위 읽기 전용 출력·마스킹 로그를 제공한다. 실행 이미지와 NAS 기준 커밋을 확정하고 POS/HOS/8T/QRS 오류를 분석한다. 기존 백업·격리 복원 기록과 실제 설정 일치를 확인하고 필요한 NAS 쓰기/롤백 시험 범위를 별도 승인한다. 초대 정책·URL·운영 설정을 결정한다. 그 결과를 반영한 19개 후보와 NAS 기준 이후 모든 커밋 경로를 리뷰하여 **실제 릴리스 SHA와 정확한 manifest**를 만든 뒤 깨끗한 체크아웃에서 드라이런을 통과시킨다. 마지막으로 특정 SHA·파일·백업·검증 범위에 대한 운영 배포 승인을 받는다. 이 조건들이 충족되기 전 `-Mode Deploy`는 실행하지 않는다.
