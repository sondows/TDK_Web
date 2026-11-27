# TDKON 배포 준비 5단계 — 최종 사전점검 (2026-11-27)

상태: **BLOCKED** (NAS 폴더·권한 준비와 복구 증거가 없어 실제 배포 보류)

## 확인된 사실

- NAS SSH 직접 접속은 현재 작업 환경에서 `Permission denied`였다. 아래 NAS 정보는 사용자가 읽기 전용 명령으로 제공한 출력이다.
- 새 호스트 경로 `/volume1/TDK-POS/tdk-pos/storage/tdktv-images`는 아직 없다.
- 기존 컨테이너에는 `/app/.pos-runtime/tdktv-images` 폴더가 없다. 기존 마운트는 메뉴, QR 안내, QR 제목, 영수증 로고 네 경로이며 TV 이미지 마운트는 없다.
- 기존 컨테이너의 실행 사용자 이름은 `node`, UID/GID는 `1000:1000`이다.
- 운영 DB의 TV 이미지 행은 이전 확인에서 0건이었다. 현재 확인한 기본 저장 위치와 마운트에는 이전할 TV 이미지가 없지만 다른 임의 경로의 파일 존재 여부까지 증명한 것은 아니다.
- Compose는 `./storage/tdktv-images`를 `/app/storage/tdktv-images`로 바인드하며 앱 환경 변수도 컨테이너 경로와 일치한다. `create_host_path: false`로 새 폴더가 없을 때 자동 생성을 막았다. 메뉴·QR·영수증 마운트는 유지했다.
- 운영 TV 스키마와 TV-7 주요 구조는 사용자가 phpMyAdmin 결과로 확인했다. 현재 NAS 앱 DB 계정의 조회 권한은 미확인이다.
- `deploy.bat` 기본 경로는 `prepare-release.ps1`의 TDKON 범위 자동 커밋·푸시 이후 `simple-release.ps1`을 실행한다. NAS의 `simple-nas-release.sh`는 Git pull, 이미지 빌드, 컨테이너 재생성, health 확인을 한다. 이미지 백업과 자동 복구는 제공하지 않는다. 현재 TDKON 범위에는 다수의 미커밋·신규 파일이 있어 배포 전 파일 목록 검토가 필요하다.

## 로컬 검증

- TypeScript, 변경 관련 ESLint, API 접근 테스트 30건, QR 인증/TV 정책 테스트 10건, 로컬 프로덕션 빌드 통과.
- Compose YAML 파싱과 TV 바인드 설정 검사 통과. NAS `docker compose config`는 미실행. 빌드 경고 2건은 기존 메뉴 이미지 저장 경로 추적 관련이다.
- TV-7C/7D HTTP·DB 통합 테스트는 이번 단계에서 실행하지 못했다. 개발 DB 연결은 현재 환경에서 `EACCES`이다. 과거 체크포인트의 통과 기록과 이번 검증을 구분한다.

## 배포 전 반드시 완료할 작업

1. 운영 DB 백업 파일과 현재 컨테이너 이미지의 보존 방법을 확인한다. 라이브 주문·결제 DB를 과거 시점으로 자동 복원하지 않는다.
2. 승인 후 NAS에서 `sudo mkdir -p /volume1/TDK-POS/tdk-pos/storage/tdktv-images`를 실행하고, 해당 디렉터리만 `sudo chown 1000:1000` 및 `sudo chmod 750`으로 준비한다. 다른 저장소의 권한은 변경하지 않는다.
3. 실제 NAS에서 디렉터리 권한과 `docker compose config --quiet`를 확인한다. 운영 `.env.production`의 `DB_NAME=TDK_POS`, TV 이미지 경로, QR 인증 플래그 값을 비밀값 노출 없이 확인한다. 최초 배포는 QR 인증 OFF로 시작한다.
4. 자동 커밋·푸시 대상 TDKON 파일 목록을 검토한다. 불필요한 개발 SQL·문서·미완성 코드를 포함하지 않는 승인된 릴리스를 만든다.
5. 이전 이미지 ID와 복구 가능한 백업을 확보한 뒤에만 배포한다. 기본 `deploy.bat` 경로에는 자동 백업·복구가 없다.
6. 배포 후 DP1~DP5 공개 재생과 API, HOS·POS·KDS·ADM·QRS 기본 동작, 이미지 업로드/조회, 컨테이너 로그를 확인한다. QR 인증은 별도 승인된 운영 테스트 조건에서 ON으로 전환해 검증한다.

이번 단계에서 NAS 디렉터리 생성, 권한 변경, 운영 DB 변경, 환경 변수 변경, 배포, Git 커밋·푸시는 수행하지 않았다.
