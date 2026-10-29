# POS / KDS 경로 통일 배포안

이 문서는 코드 검증 결과와 운영 배포 절차입니다. NAS 설정·운영 DB·백업은 이 작업에서 변경하지 않았습니다. 운영 배포는 별도 승인 후 진행합니다.

## 확인된 운영 구성

- NAS `eth0`: `192.168.0.83/24` → 매장망 `192.168.0.0/24`; 작업 PC의 기본 게이트웨이는 `192.168.0.1`입니다.
- Caddy는 `tdk-caddy` 컨테이너에서 HTTPS 443을 받고 `192.168.0.83:3000`으로 전달합니다. 현재 활성 Caddyfile은 도메인과 한 줄의 `reverse_proxy`만 포함합니다. NAS의 활성 파일은 `/volume1/TDK-POS/caddy/Caddyfile`이며 컨테이너의 `/etc/caddy/Caddyfile`에 읽기 전용으로 마운트됩니다.
- 앱 컨테이너는 현재 브리지 네트워크에서 `0.0.0.0:3000`에 게시되어 있습니다. 작업 PC가 직접 접속 중인 상태에서 앱 컨테이너의 `/proc/net/tcp`에는 PC `192.168.0.54` 대신 Docker 게이트웨이 `172.18.0.1`이 연결 상대인 것이 확인됐습니다. 새 Compose는 `network_mode: host`로 소켓 원격 IP를 보존하고, 앱 서버는 NAS LAN 주소 `192.168.0.83:3000`에만 바인딩합니다. **라우터의 WAN 3000 포트 전달 및 방화벽 허용 여부도 별도로 확인해야 합니다.**

## 새 동작

| 접속 | 결과 |
| --- | --- |
| `http://192.168.0.83:3000/tdkpos` | 기존 POS 화면. 인증이 필요하면 `/tdkpos/login` |
| `http://192.168.0.83:3000/tdkkds` | 기존 KDS 화면. 실제 소켓 IP가 명시된 매장망이면 기기등록 검사만 면제 |
| 내부 `/pos`, `/kitchen`, `/login` | 새 경로로 307 이동. 쿼리 문자열 유지 |
| 외부 HTTPS `/tdkkds` | 승인된 기기와 직원 ID/PIN을 각각 확인 |
| 외부 HTTPS `/tdkpos`, `/pos`, POS API | 403. 클라이언트가 신뢰 표시 헤더를 보내도 차단 |
| 내부·외부 `/tdkadm` | 관리센터 대시보드 또는 `/tdkadm/login`; 내부 메뉴도 `/tdkadm/...` 사용 |
| 기존 `/admin`, `/admin/...` | 대응하는 `/tdkadm` 경로로 307 이동; `/api/admin`은 기존 API 경로 유지 |
| QR 주문 | 기존 경로·정책 유지 |

실제 라우트는 `/pos`, `/kitchen`을 유지하고 앱 프록시가 새 경로를 rewrite합니다. POS 로그인·화면 이동 주소는 `/tdkpos` 계열을 사용합니다. 새 경로의 POS·KDS PWA manifest는 각각 별도 라우트에서 제공합니다. KDS 로그인·주문 API는 기존 `/api/kitchen`을 그대로 사용하므로 세션과 DB 스키마를 변경하지 않습니다.

## 직접 LAN 기기 면제의 신뢰 경계

Docker의 호스트 네트워크로 실행하는 새 `server.cjs`는 Node 소켓의 실제 원격 주소를 읽습니다. 요청 Host가 `KDS_DIRECT_HOST`와 정확히 같고, 원격 주소가 `KDS_INTERNAL_CIDRS` 또는 명시된 VPN 대역에 있으며, `KDS_DIRECT_EXCLUDED_IPS`에 없을 때만 내부망 확인 헤더를 생성합니다. 브라우저가 보낸 같은 이름의 헤더는 먼저 제거합니다. Caddy 경유 요청은 별도 프록시 원본 비밀값을 확인해야 앱에 들어갈 수 있으며, 최소 Caddy 설정은 클라이언트 IP 인증 헤더를 제거하므로 외부 기기 승인 정책이 유지됩니다. 설정이 없거나 실제 PC IP 대신 브리지 IP만 보이면 면제는 꺼진 채 유지됩니다. 브리지 대역을 매장망으로 추가하지 않습니다.

운영 앱 환경 변수에 다음 값을 설정합니다. 비밀값은 `openssl rand -hex 32`로 새로 생성하고 파일이나 대화에 원문을 남기지 않습니다.

```dotenv
KDS_PROXY_SHARED_SECRET=<64자리 난수 16진수>
KDS_INTERNAL_CIDRS=192.168.0.0/24
KDS_INTERNAL_VPN_CIDRS=
TDK_APP_BIND_HOST=192.168.0.83
KDS_DIRECT_HOST=192.168.0.83:3000
KDS_DIRECT_EXCLUDED_IPS=192.168.0.1
```

직접 주소는 HTTP이므로 내부망에서 입력하는 PIN과 직원 세션은 해당 LAN의 전송 보안에 의존합니다. 외부 공식 주소의 기기 쿠키는 HTTPS에서 Secure로 발급합니다. 향후 내부 접속도 HTTPS로 옮기려면 매장 DNS가 공식 도메인을 NAS 내부 IP로 가리키게 하고 Caddy의 클라이언트 IP 전달을 별도로 검증해야 합니다.

## Caddy 최소 변경

경로 처리를 위해 Caddy 규칙을 바꿀 필요는 없습니다. 다만 현재 운영 앱에서는 브라우저가 `X-TDK-Trusted-Network` 헤더를 넣으면 POS 네트워크 제한을 우회하는 것이 읽기 전용 요청에서 확인됐습니다. [Caddyfile.unified-paths.example](Caddyfile.unified-paths.example)의 세 `header_up -...` 줄은 외부 입력을 제거합니다. `X-TDK-Proxy-Origin-Secret`는 Caddy가 앱에 보내는 요청만 받아들이는 용도로 덮어써서 전달합니다. `X-TDK-Proxy-Client-IP`는 Caddy가 확인한 IP를 로그인·기기등록 횟수 제한용으로만 전달하며, 내부망 기기등록 면제에는 사용하지 않습니다. **Caddy 컨테이너 환경 변수에 앱과 같은 난수 비밀값을 먼저 설정하고 Caddy를 적용한 뒤 앱을 배포해야** ADM·KDS·QR 접속 중단을 피할 수 있습니다. Caddy는 클라이언트 IP 인증 헤더를 전달하지 않으므로 외부 KDS 기기등록 정책을 유지합니다. 활성 파일은 `/volume1/TDK-POS/caddy/Caddyfile`입니다. Caddy 환경 변수를 영속적으로 설정할 Compose 파일이나 컨테이너 실행 구성을 먼저 확인하고, 활성 설정을 백업한 후 Caddy 구문을 검사하고 적용합니다.

## 승인 후 확인 순서

1. 새 앱 이미지·환경 변수·Compose 호스트 네트워크 설정과 Caddyfile 변경안을 따로 검토합니다. 호스트 네트워크 전환 시 기존 브리지의 `DB_HOST`·스토리지 경로가 동작하는지 확인합니다. 기존 기기관리 코드가 쓰는 운영 DB 스키마가 준비됐는지도 확인합니다. 이번 경로 변경 자체는 DB 마이그레이션이 없습니다.
2. Caddy 환경에 비밀값을 주입하고 Caddyfile을 백업·검증·재적용합니다. 기존 앱은 새 원본 확인 헤더를 무시하므로 먼저 적용해도 동작이 유지됩니다.
3. 앱을 호스트 네트워크로 재배포한 뒤, 작업 PC뿐 아니라 실제 매장 KDS PC에서 `/tdkkds`를 열고 기기 쿠키가 없는 새 브라우저로 직원 ID/PIN 로그인을 확인합니다. 앱 소켓 IP가 PC 주소인지 확인합니다.
4. 등록된 매장 PC도 로그인·주문 조회·조리 시작·완료를 확인합니다. 기존 `/kitchen`과 `/pos`의 307 이동, POS 로그인 후 주소와 새로고침을 확인합니다.
5. 모바일 데이터에서 `/tdkkds`는 미등록 기기라면 등록을 요구하고 승인 기기라면 직원 PIN을 요구하는지 확인합니다. 매장 세션을 모바일 데이터에서 재사용해도 기기 승인 없이는 API가 차단돼야 합니다.
6. 모바일 데이터에서 `/tdkpos`, `/pos`와 POS API가 차단되는지 확인합니다. 위조 `X-TDK-Trusted-Network` 헤더를 보낸 경우도 403이어야 합니다. WAN 3000 포트가 닫혀 있는지 별도 확인합니다.
7. ADM 로그인 후 주소가 `/tdkadm`인지, 사이드바 메뉴와 보안 → 기기관리 경로가 `/tdkadm/...`인지, 로그아웃 후 `/tdkadm/login`인지 확인합니다. 기존 `/admin` 주소의 이동과 QR 주문, POS 결제·테이블 기능도 확인합니다. 문제 발생 시 기존 앱 이미지와 백업한 Caddyfile로 되돌립니다. DB를 초기화하거나 백업 설정을 바꾸지 않습니다.

## 로컬 검증 결과

- `node --experimental-strip-types --test src/lib/*.test.mjs`: 172개 통과.
- `npx tsc --noEmit` 및 변경 영역 ESLint: 통과.
- 로컬 개발 서버: 내부 `/tdkpos`는 로그인 화면으로, `/tdkkds`는 KDS 화면으로 이동하고 기존 `/pos`, `/kitchen`은 각각 새 경로로 307 이동했습니다. 두 새 manifest는 각 앱의 시작 경로와 범위를 반환했습니다.
- 외부 Host를 사용한 로컬 요청: POS 새·기존 경로는 403, KDS·ADM은 200, 기존 `/kitchen`은 `/tdkkds`로 307 이동했습니다.
- NAS 호스트 네트워크 전환, 실제 매장 PC의 미등록 KDS 로그인, 외부 승인 기기 로그인 및 WAN 3000 차단은 운영 배포 전에는 실측할 수 없습니다. 승인 후 위 순서대로 검증합니다.
