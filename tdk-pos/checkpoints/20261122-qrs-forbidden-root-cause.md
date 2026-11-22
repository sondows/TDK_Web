# QRS Forbidden 및 내부 주소 리다이렉트 조사

기준: 2026-11-22, 로컬 `main` HEAD `a2955c4d5abdce6ac27e04895655ea422adc9180`. 이번 조사에서 운영 NAS·운영 DB·운영 QR 세션은 변경하지 않았고, Git 커밋·푸시도 하지 않았다.

## 확인된 원인

1. 외부 요청의 첫 차단 지점은 `src/proxy.ts`의 `isExternalAdminPathAllowed()` 판정이다. 변경 전 `src/lib/host-access.ts`는 `/q/{identifier}`를 허용하면서 신규 `/tdkqrs/{identifier}`를 거부했다. 판별 함수를 실제 실행한 결과 기존 경로는 `true`, 신규 일반·초대 경로는 모두 `false`였다. `src/proxy.ts`의 마지막 분기는 이 경우 정확히 본문 `Forbidden`, 상태 403을 반환한다. 운영 이미지가 이 코드를 실행 중인지는 NAS 접근 불가로 미확인이다.
2. 고객 리다이렉트의 `Location`은 `new URL(destination, request.url)`에서 생성됐다. 로컬 개발 서버에 세션을 만들지 않는 무효 QR 요청을 보내니 `/tdkqrs/not-a-qr`는 302와 `http://0.0.0.0:3000/qrorder/unavailable`, `/q/not-a-qr`는 307과 `http://0.0.0.0:3000/tdkqrs/not-a-qr`를 반환했다. 따라서 요청 URL이 내부 호스트로 표현되면 고객 응답에도 내부 호스트가 들어간다는 현상을 재현했다. 운영에서 보고된 `https://192.168.0.83:3000/qrorder/order`도 같은 생성 방식과 일치한다. 운영 프록시의 정확한 헤더 및 실행 이미지 증거는 미확인이다.

| 구간 | 확인 결과 | 판정 |
|---|---|---|
| QR URL 생성 | 로컬 생성기는 공개 HTTPS `/tdkqrs/` 사용 | 확인 |
| DNS·HTTPS·Caddy | 이 실행 환경에서 공개 HTTPS 연결 실패, 실제 Caddyfile 미열람 | 미확인 |
| Next.js 경로 | 빌드에 신규·호환 경로 포함 | 확인 |
| 공개 경로 판별 | 신규 경로 거부 재현, 수정 후 GET 허용·POST 거부 | 확인 |
| DB·세션 | 로컬 서버 `TDK_POS_TEST` 확인; 일반·초대 통합 검사 통과 | 개발 확인 |
| 쿠키 | 개발 통합 검사의 HttpOnly·HTTPS Secure·테이블 경계 확인 | 개발 확인 |
| 리다이렉트 | 내부 URL 생성 재현; 운영용 공개 origin 고정 회귀 검사 통과 | 로컬 확인 |
| 운영 실행 이미지·로그 | NAS SSH 22 연결 거부 | 미확인 |

## 최소 수정

- `host-access.ts`: 고객 최초 QR 진입 경로 `/tdkqrs/`를 GET·HEAD에만 허용한다. 형식이 잘못된 QR도 라우트의 안내 화면으로 진입하도록 길이를 제한한 영숫자·`_`·`-` 경로를 허용한다. 주문 API와 직원 전용 경로 정책은 유지한다.
- `qr-customer-redirect.ts`: 운영 환경 고객 리다이렉트의 기준을 `https://tdkon.myasustor.com`으로 고정하고 잘못된 `QR_PUBLIC_BASE_URL` 설정을 거부한다. 일반·초대·기존 `/q/` 호환 라우트와 세션 쿠키 응답이 이 함수를 사용한다.
- QR 세션 발급 트랜잭션, 토큰 생성·해시, `HttpOnly`·`SameSite`·`Secure` 쿠키 정책은 변경하지 않았다. `/qrorder`에서도 쿠키가 필요하므로 기존 `Path=/`를 유지한다.

## 검증 및 남은 조사

TypeScript, 관련 ESLint, 경로·리다이렉트 회귀 테스트 9개, Next.js 프로덕션 빌드가 통과했다. `TDK_POS_TEST`의 일반 QR 진입·주문·종료와 초대 합류·보안 예외 통합 검사도 통과했다. 빌드의 메뉴 이미지 파일 추적 경고 2건은 이 경로 오류와 별개다.

운영 NAS의 이미지 ID·Git SHA·시작 시각·Caddy 실제 설정·서버 로그와 스마트폰 응답은 확인하지 못했다. 배포 판정은 **추가 검증 필요**다. 운영에 적용하기 전에 실행 버전과 실제 403 응답 주체를 확인해야 한다.
