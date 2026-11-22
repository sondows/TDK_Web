# POS 테이블 QR 주문 조회 Forbidden 조사

기준일: 2026-11-23 KST. 로컬 `main` HEAD `79e44907321b7ab648a57e0cb694da9a16ef3c2b`. 조사 전 TDKON 범위의 미커밋·스테이징 파일은 없었다. 이번 작업은 로컬 코드와 테스트만 변경했으며 운영 DB·NAS·Git 원격은 변경하지 않았다.

## 요청 흐름과 확인된 사실

| 단계 | 확인 내용 | 판정 |
|---|---|---|
| QRS 제출 | `POST /api/qr/table-orders`가 `qr_orders`에 `PENDING` 주문과 항목을 저장 | 코드 확인 |
| HOS 수신 | `HosQrPendingOrders.loadPendingOrders()`가 `GET /api/pos/qr-table-orders`를 호출 | 코드 확인; 사용자 화면에서 주문 표시 |
| POS 수신 | `PosQrTableOrderPanel.refresh()`가 **같은 GET API**를 호출 | 코드 확인 |
| POS 파싱 | 기존 코드는 상태·Content-Type 확인 없이 `response.json()` 호출 | 코드 확인; `Forbidden` 본문이면 보고된 구문 오류 발생 |
| API 인증 | 핸들러의 미인증 응답은 JSON 401; 개발 서버의 무쿠키 실제 GET도 401 JSON | 확인 |
| 접근 제어 | 공개 Host의 POS API는 검증된 HTTPS ingress가 없으면 `src/proxy.ts`에서 일반 텍스트 403. `server.cjs`도 신뢰되지 않은 운영 ingress에 일반 텍스트 403 반환 | 코드 확인; 운영에서 어느 계층인지 미확인 |
| DB 조회 | HOS가 동일 API로 주문을 표시하므로 HOS 요청 조건에서 쿼리는 동작 | 사용자 관찰과 코드 연결; 운영 DB 직접 확인 아님 |
| 운영 NAS | SSH 22 연결 거부, 실행 이미지·Caddy 설정·서버 로그 미확인 | 미확인 |

현재 증거는 **POS의 API 요청이 핸들러 이전에서 거부됐을 가능성**을 강하게 지지한다. 실제 POS 요청의 URL·상태·응답 헤더, 운영 이미지 및 로그가 없으므로 Caddy·`server.cjs`·`src/proxy.ts` 중 최초 거부 지점은 확정할 수 없다. 직원 API를 공개 경로로 추가하거나 인증을 우회하는 수정은 하지 않았다.

## 로컬 수정 및 검증

- `PosQrTableOrderPanel`이 401·403·비JSON·서버 실패를 JSON 파싱 전에 구분한다. 조회 실패는 주문 0건 안내와 분리한다. 정상 JSON 목록이 없으면 성공으로 간주하지 않는다.
- `pos-qr-table-response.ts`와 회귀 테스트는 일반 텍스트 403, JSON 401, 비JSON 503, 실제 빈 목록과 서버 오류를 구분한다. 응답 본문에 담긴 내부 정보를 직원 화면에 노출하지 않는다.
- TypeScript, 해당 ESLint, 회귀 테스트 2개, Next.js 프로덕션 빌드 통과. 빌드의 메뉴 이미지 경로 추적 경고 2건은 본 오류와 관련 없는 기존 경고다.

## 남은 확인

POS 브라우저 Network에서 `GET /api/pos/qr-table-orders`의 Request URL·Status·Content-Type·응답 첫 줄을 확인한다. 운영 NAS에서 동일 시각의 Caddy와 앱 로그, 실행 이미지 ID·커밋, `TDK ingress rejected` 기록을 읽어 최초 403 계층을 특정한다. 쿠키 값과 프록시 비밀은 수집하지 않는다. 그 뒤 원인 계층의 최소 수정과 POS/HOS 승인·거절 및 KDS 후속 통합 검사를 수행해야 한다.

**배포 판단: 추가 검증 필요.** 현재 수정은 오류 표현과 빈 상태 오판을 개선하지만 운영의 403 접근 거부 자체를 해소했다고 주장할 근거가 없다.
