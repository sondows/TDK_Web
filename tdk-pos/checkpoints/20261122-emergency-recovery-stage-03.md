# TDKON 긴급 복구 3/5 — 개발 환경 수정 및 검증

기준일: 2026-11-22. 로컬 HEAD `b9d7ab2`. 앞선 조사 기록: `20261122-qr-session-schema-review.md`, `20261122-emergency-recovery-stage-02.md`.

이번 단계에서 운영 DB `TDK_POS`, NAS, Docker, Caddy, 운영 QR 세션은 변경하지 않았다. 로컬의 기존 미커밋 변경사항을 초기화하지 않았으며, `/q/{identifier}`, `/q/join/{token}`, `/qrorder` 경로를 유지했다. 아래의 **확인됨**은 개발 환경이나 현재 소스에서 직접 확인한 사실이며, 과거 운영 장애를 재현했다는 뜻은 아니다.

## A. NAS 조사 결과

- **미확인:** NAS 실행 컨테이너, 불변 이미지 ID, 실행 Git 커밋, 생성 시각, 11월 21~22일 POS/HOS/8T/QRS 서버 오류 로그. 이전 단계의 읽기 전용 SSH 배치 인증은 `Permission denied (publickey,password,keyboard-interactive)`로 실패했다. 이 단계에서 비밀번호 추측이나 운영 변경을 시도하지 않았다.
- **확인됨:** 이전 단계에서 공개 HTTPS의 정적 QR 안내 페이지 응답은 확인했지만, 이는 실행 빌드 또는 앱 기능의 정상 여부를 증명하지 않는다. HOS의 과거 영문 오류 문구는 `b9d7ab2` 이전 소스의 표시와 일치한다. NAS 커밋의 증거는 아니다.
- 필요한 증거: NAS에서 앱 컨테이너의 `docker ps`, `docker inspect`로 이름·이미지 ID·생성 시각·revision label을 확인하고, `docker logs --timestamps --since '2026-11-21T00:00:00+09:00' --until '2026-11-23T00:00:00+09:00' <container>`로 해당 요청의 오류를 수집한다. 토큰, 쿠키, 비밀번호, 고객정보는 제거한다. `DB_NAME=TDK_POS`와 `QR_PUBLIC_BASE_URL`의 설정 여부만 확인하고 비밀 환경값 전체를 출력하지 않는다.

## B. POS/HOS

- **확인됨:** 현재 TEST와 운영 DB에는 모두 `qr_sessions.table_id`가 존재한다. 현재 소스의 POS/HOS QR 현황 SQL은 양쪽 DB에서 실행됐으며 MariaDB 1054가 나지 않았다(1단계 결과). HOS `loadHosTables()`의 병렬 필수 조회 중 하나가 실패하면 전체 API가 503을 반환한다. POS는 서버 렌더 중 필수 DB 작업 실패를 전파할 수 있다(2단계 소스 분석).
- **미확인:** 장애 당시 NAS가 실행한 소스·SQL, 실제 POS 오류, HOS 503의 원인 쿼리. 인증된 POS/HOS 페이지 및 API의 통합 테스트는 수행하지 못했다. 따라서 과거 POS/HOS 장애를 현재 `table_id` 스키마나 특정 SQL 탓으로 확정할 수 없다.
- 수정: POS/HOS 소스 변경 없음. 확인되지 않은 오류를 숨기거나 빈 테이블을 성공 결과로 반환하는 변경은 하지 않았다.

## C. 테이블 취소와 QR 세션 종료

- **확인됨:** 현재 `src/app/api/table-cancellations/route.ts`는 현재 OPEN 테이블 세션과 병합 세션을 잠그고, PENDING QR 주문을 확인한 다음, `session_id IN (...) OR table_id IN (...)` 범위의 ACTIVE QR 세션만 같은 트랜잭션에서 닫는다. 선택 테이블의 미연결 QR 세션, 연결된 QR 세션, 복수/동반 QR 세션을 포함하는 SQL 범위를 `TDK_POS_TEST`의 격리된 임시 행으로 검증했다. 다른 테이블의 QR 세션은 그대로 남았다. 미처리 QR 주문 차단, QR 세션이 없는 테이블, 재실행의 멱등성, SAVEPOINT 오류 롤백도 통과했다. 테스트의 모든 임시 행은 최종 롤백으로 제거됐다.
- **미확인:** 인증과 PIN 확인을 포함한 실제 취소 API 전체 경로, 결제·재고 연동을 포함한 전체 트랜잭션, 과거 운영 8T 요청의 정확한 오류. 운영 8T에는 취소 요청을 보내지 않았다.
- 수정: 취소 코드 변경 없음. 검증 스크립트 `scripts/verify-qr-cancellation-scope.cjs`를 추가했다. 현재 증거로 8T 장애 원인을 특정할 수 없다.

## D. QR URL

- **확인됨:** 기존 QR URL 생성은 `QR_PUBLIC_BASE_URL`이 없으면 요청의 forwarded Host 또는 Host를 사용했다. 내부 IP로 관리 화면에 접근해 이미지/내보내기를 생성하면 내부 IP·HTTP가 QR 데이터에 들어갈 수 있는 코드 경로였다. 실제 인쇄물의 QR 데이터와 NAS 환경변수는 미확인이다.
- 수정: `src/lib/admin-qr-export.ts`의 공통 `publicQrUrl`을 `https://tdkon.myasustor.com/q/{identifier}`로 고정했다. 선택적 `QR_PUBLIC_BASE_URL`은 정확한 HTTPS 공개 origin만 허용하며 HTTP, 사설 IP, 다른 도메인, 추가 경로 및 자격정보를 거부한다. 값이 없으면 같은 공개 origin을 사용한다. QR 목록/표시 및 테이블 주문 링크, PNG, SVG, ZIP 내보내기가 이 함수를 사용한다. 잘못된 설정에서는 다운로드/발급 경로가 명확한 오류를 반환하며 요청 Host로 대체하지 않는다. `.env.production.example`에 공개 설정 예시를 추가했다.
- 검증: 설정 없음/정상/HTTP/IP/잘못된 Host 설정과 PNG·SVG에 전달되는 대상 URL을 포함한 QR 내보내기 테스트 5개 통과. 실제 QR 인쇄물 디코딩, 운영 NAS 설정, 운영 이미지 다운로드는 미검증이다. 기존 스티커를 일괄 재발급하거나 폐기하지 않았다.
- 범위: 초대 링크 API `src/app/api/qr/order-invites/route.ts`의 `/q/join/{token}` URL은 이번 고정 스티커 QR 생성 경로와 별개이며 요청 origin을 사용한다. 초대 URL의 공개 origin 정책은 이번 단계에서 변경하지 않았고 4단계에서 별도로 검토해야 한다.

## E. QRS 고객 흐름

- **확인됨:** 개발 HTTP 통합 테스트에서 `/q/{identifier}`가 TEST DB의 QR 세션을 생성한 뒤 `Response.redirect(...)`의 불변 헤더에 `Set-Cookie`를 추가하면서 `TypeError: immutable`이 발생했다. 결과적으로 세션이 커밋되지만 고객 쿠키가 없고 서비스 오류 안내로 이동하는 결함을 재현했다. 이 결함은 로컬 소스에서 확정됐지만 과거 NAS 빌드에 존재했는지는 미확인이다.
- 수정: `src/app/q/[identifier]/route.ts`가 `Location`과 `Set-Cookie`를 함께 설정한 새 302 응답을 반환한다. 오류 진단에는 단계·QR 코드 ID·안전한 오류 종류/코드만 기록하고 토큰 또는 SQL 본문은 남기지 않는다. 기존 HttpOnly, SameSite, HTTPS에서 Secure 쿠키 정책은 유지했다.
- 검증: `TDK_POS_TEST`의 고유 임시 QR 코드/테이블로 QR 최초 진입 → 테이블 ID가 연결된 ACTIVE 세션 → HttpOnly 쿠키 → 주문 화면 200 → 인증된 QR 주문 조회 → QR 주문 POST 201 및 PENDING 행 → 세션 종료 후 접근 거부까지 통과했다. 테스트는 `scripts/verify-qr-entry-development.cjs`에 있다. 사용 중이던 로컬 개발 서버는 종료하지 않았다. TEST 임시 행과 테스트 주문은 스크립트에서 정리했다. 실제 고객 브라우저 화면, 운영 QR 스캔, 운영 앱 로그는 미검증이다.

## F. 전체 검증

- TypeScript `tsc --noEmit`: 통과.
- 변경 소스와 테스트 스크립트 ESLint: 오류 0. `.env.production.example`은 ESLint 대상 설정이 없어 경고 1건만 발생했다.
- 관련 단위 테스트: 23개 통과(공개 QR URL, 세션 만료/접근, QR 현황, HOS 상태/오류 등).
- TEST DB 취소 범위·롤백 테스트: 통과. TEST HTTP QRS 진입·주문·종료 통합 테스트: 통과.
- Next.js 16.3.5 프로덕션 빌드: 종료 코드 0. 기존 `menu-image-storage.ts`의 동적 파일 경로 추적 경고 2건은 남아 있다.
- `git diff --check`: 오류 없음. 상위 저장소의 다른 디렉터리에 있던 다수의 기존 변경과 삭제는 건드리지 않았다.
- 미실행: 인증된 POS/HOS API 통합 테스트, PIN이 필요한 실제 취소 API 전체 테스트, POS 결제 완료·QR 주문 승인/거절의 전체 UI 회귀, 운영 빌드·브라우저 검증. 이를 성공으로 표기하지 않는다.

## G. 4단계 준비

- 수정 파일: `src/lib/admin-qr-export.ts`, QR PNG/SVG/ZIP 및 테이블 주문 링크 API, `src/app/q/[identifier]/route.ts`, `.env.production.example`; 테스트 변경: `src/lib/admin-qr-export.test.mjs` 및 두 TEST 전용 검증 스크립트. `src/app/qrorder/[notice]/page.tsx`와 QR entry/테스트 파일에는 이번 단계 전부터 미커밋 변경이 있었으므로 diff 검토 시 구분해야 한다.
- **운영 DB 변경·마이그레이션 필요성: 없음.** 현재 운영 `qr_sessions.table_id` 구조가 이미 정상이다. 이미 적용된 것으로 보이는 `20261122_qr_sessions_table_id.sql`을 재실행하지 않는다.
- **배포 필요성: 있음, 별도 4단계 판단 대상.** 이번 수정은 로컬 코드에만 있으며 NAS에는 배포하지 않았다. 배포 전에 실행 이미지/커밋과 운영 오류 로그를 확보해 과거 POS/HOS/8T 원인을 따로 판별하고, 현재 이미지 백업·롤백 방법을 기록해야 한다.
- **환경변수:** `QR_PUBLIC_BASE_URL`은 없으면 canonical HTTPS로 동작한다. 설정한다면 `https://tdkon.myasustor.com`이어야 한다. NAS 실제 설정은 미확인이다. 운영에서 기존 인쇄 QR의 페이로드가 사설 IP인지 별도로 확인해야 한다.
- 배포 후에는 운영 앱의 정확한 이미지 ID/커밋, QR URL PNG/SVG/ZIP 결과, QRS 쿠키·주문, POS/HOS 테이블 조회, 취소/결제 경로를 안전한 절차로 재검증해야 한다. 운영 데이터에 쓰는 테스트는 4단계에서 별도 승인과 절차가 필요하다.
