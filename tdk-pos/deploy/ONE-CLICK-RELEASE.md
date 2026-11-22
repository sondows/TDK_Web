# TDKON `deploy.bat` 원클릭 배포 절차

작성일: 2026-11-22. 이 문서는 **배포 자동화 코드의 동작**을 설명한다. `-Mode PrepareRelease`는 로컬 검사·범위 검증·커밋·푸시만 수행하며 NAS에 접속하지 않는다. 기존 4.5단계의 수동 `-Mode DryRun`/`-Mode Deploy` 경로는 유지된다.

## 실행

저장소 루트의 Windows 터미널에서 실행한다. 로컬 검사가 통과하면 `deploy.bat`와 `tdk-pos` 안의 제작 파일만 커밋하고 `origin/main`에 일반 푸시한 다음 NAS 사전점검으로 넘어간다.

```cmd
.\deploy.bat
```

SHA 인자는 필요 없다. 화면에 나타나는 전체 릴리스 SHA와 변경 파일 목록을 직접 확인한다. **최종 승인 입력 전에는 앱 컨테이너가 교체되지 않는다.** 단, 최종 승인 전 백업 준비 단계는 NAS의 백업 디렉터리와 Docker 이미지 태그에 쓰기를 수행한다. 운영 NAS에서 이 단계를 실행하려면 사전에 해당 백업 작업이 허가돼 있어야 한다. Enter 또는 다른 입력은 배포 취소다.

커밋·푸시까지만 실행하고 NAS에는 접속하지 않으려면 다음을 쓴다.

```cmd
.\deploy.bat -Mode PrepareRelease
```

드라이런은 기존과 같이 명시적으로 실행할 수 있다. 드라이런은 NAS에 접속하지 않는다.

```powershell
.\deploy.bat -Mode DryRun -ApprovedSha <40자리_릴리스_SHA> -BaseSha <40자리_NAS_기준_SHA> -ApprovedPathsFile <검토된_파일_목록>
```

## 자동화의 순서와 차단 조건

1. 로컬 `main` HEAD의 40자리 SHA와 TDKON Git 변경사항을 확인한다. 읽기 권한이 없는 로컬 인증서 폴더 `tdk-pos/.local-dev-https`는 **추적 파일이 0개인지 확인한 뒤** 미추적 탐색에서만 제외한다. 다른 프로젝트의 기존 스테이징이 있으면 중단한다. 임시 인덱스로 `deploy.bat`와 `tdk-pos`의 정확한 후보 경로를 미리 확인하고 인증서·환경파일·생성 파일을 거부한다.
2. TypeScript, 관련 ESLint·단위 테스트, 프로덕션 빌드와 `TDK_POS_TEST` QR 통합 검사를 통과해야 한다. 테스트 도중 파일 목록이나 HEAD가 바뀌면 중단한다. 그 뒤 TDKON 범위만 실제 인덱스에 추가하고 미리 본 목록과 같은지 확인한 다음 커밋한다. 원격 `main`이 원래 HEAD와 일치할 때만 **강제 옵션 없이** 푸시하며 원격 SHA를 다시 확인한다. 실패 시 NAS 단계로 넘어가지 않고 현재 인덱스/로컬 커밋을 보존한다. 비밀 파일과 저장소 다른 프로젝트 변경은 포함하지 않는다.
3. SSH 호스트 키 검증을 유지한 채 NAS의 `nas-release.sh inspect`를 호출한다. 현재 컨테이너 ID, 불변 이미지 ID, 이미지 revision, NAS Git HEAD, 상태·health, 공간, Docker Compose 설정 해시를 조회한다. 실행 이미지의 Git revision label 또는 **별도 승인된 이미지 ID 기준선 기록**이 없으면 중단한다. 이미지 태그와 NAS checkout SHA만으로 실행 버전을 추정하지 않는다. Compose의 직접 `config --hash`가 실행 컨테이너 레이블과 다르면, `env_file`을 메모리에서 해석한 설정을 다시 해시해 비교한다. 이 값도 다르면 중단한다. 환경변수 값은 화면이나 임시 파일에 출력하지 않는다.
4. NAS 기준 커밋이 로컬 릴리스 커밋의 조상인지, `origin/main`이 릴리스 SHA와 일치하는지 확인한다. 두 커밋 사이의 **모든 경로**를 출력하고 TDKON 밖 경로는 거부한다. 임시 Git 인덱스에서 `git diff --cached --check`를 실행하며 실제 인덱스는 보존한다. 화면에 출력된 정확한 경로 목록은 최종 SHA 승인 대상이다.
5. 공개키 또는 터미널의 정상적인 SSH 비밀번호 인증을 사용한다. NAS `inspect`·`prepare`·`deploy`·`rollback`마다 SSH 터미널을 열고, 필요한 경우 NAS `sudo` 비밀번호도 그 터미널에서 직접 입력한다. `sudo -v`로 같은 터미널의 인증 시각을 갱신한 뒤 기존 `sudo -n` 명령을 실행한다. 비밀번호를 인자·파일·로그·스크립트 표준입력에 넣지 않는다. 자동화는 sudo 권한이나 Docker 소켓 권한을 변경하지 않는다.
6. NAS `prepare`는 **현재 실행 이미지 ID**로 아카이브·SHA-256·tar 목록을 검증한다. 제한된 디렉터리에 Compose, `.env.production`, 실제 컨테이너 inspect 결과를 저장하고 이전 이미지에 릴리스별 백업 태그를 붙인다. 기존 백업이 있으면 이미지 ID·기준 SHA·체크섬이 모두 맞을 때만 재사용한다. 여유 공간이 부족하거나 백업이 실패하면 앱 교체 전에 중단한다. **이 검사는 컨테이너 복원 시험을 대신하지 않는다.**
7. 이미지 ID, NAS 기준·신규 SHA, 파일 수, 검사·백업·복원 시험의 한계와 Device Agent URL을 표시한다. 사용자가 **전체 신규 SHA를 다시 입력**한 경우에만 `deploy`를 호출한다. `deploy`는 백업을 다시 검증하고 원격 `main`의 승인된 커밋을 fast-forward로 받으며, `git archive`의 커밋된 소스만 Docker 빌드한다. 새 이미지에 Git SHA와 Device Agent URL label을 붙인다.
8. 앱 서비스 `tdk-pos`만 교체한다. NAS에서 이미지 ID·health, `/pos`·`/hos`·`/qr`의 로컬 GET, 새 컨테이너의 주요 오류 로그를 확인한다. 그 뒤 로컬 PC에서 세 공개 HTTPS 경로를 GET한다. 실패하면 보존한 이미지·설정으로 앱만 롤백하고 이전 이미지 ID·health를 확인한다. 네트워크 오류로 상태를 확인할 수 없으면 성공으로 표시하지 않고 NAS 현장 조사를 요구한다. 인증된 POS/HOS 업무 기능과 실제 QR 주문은 자동 검사에 포함하지 않는다.

DB 스키마 변경, Caddy/ntfy/Home Assistant 재시작, 운영 주문·결제·취소, 실제 QR 세션 생성은 이 자동화의 일부가 아니다. 운영 DB 백업·격리 복원 검증과 장애 로그 원인 확인은 별도 릴리스 게이트로 계속 관리한다.

## 초기 운영 이미지에 Git 레이블이 없을 때

현 운영 이미지 `tdk-pos:1.0.0`에 Git SHA label이 없다면 원클릭 배포는 **중단**한다. NAS Git HEAD와 현재 이미지 태그만으로 동일 코드를 실행 중이라고 단정할 수 없다. NAS 담당자가 과거 배포 로그·이미지 생성 기록·빌드 산출물로 **이미지 ID와 실제 커밋의 연결**을 확인해야 한다. 증거가 없으면 기준선 등록도 하지 않는다.

증거가 확인되고 **별도 NAS 쓰기 승인을 받은 뒤에만** `register-baseline`을 실행한다. 승인 대상은 현재 불변 이미지 ID, 검증된 40자리 커밋, 증거 파일의 SHA-256이다. `nas-release.sh register-baseline <검증된_SHA> <이미지_ID> <증거_SHA256>`은 실행 이미지 ID·health·DB 이름·NAS HEAD를 다시 확인한 뒤 `/volume1/tdk-pos-release-backups/approved-baseline`에 접근 제한 기록을 한 번만 만든다. 기존 기록을 덮어쓰지 않는다. 이후 `inspect`는 레이블 대신 **현재 이미지 ID와 일치하는 승인 기록**을 사용할 수 있으며, 승인 기록의 증거 SHA를 화면에 표시한다. 이 절차는 이미지의 소스를 자동으로 증명하지 않으므로 기록 승인 전에 운영자가 실제 증거를 검토해야 한다.

## 한 번만 확인할 로컬/NAS 설정

- SSH: `ssh -p 22 sondows@192.168.0.83`로 로그인하고 호스트 키 지문을 NAS 관리자와 확인한다. 원클릭의 여러 SSH 호출에서 비밀번호가 반복 요청될 수 있으므로 전용 승인 키가 권장된다. 기존 키를 덮어쓰거나 NAS에 무단 등록하지 않는다. 배포 스크립트의 SSH 오류는 네트워크·인증·호스트 키를 구분해 표시한다.
- NAS 권한: `sondows` 계정이 비밀번호 인증 후 Docker 조회와 제한된 백업 경로의 `install`·`cp`·`tee`·`chmod`·`sha256sum`·`tar`·`test`, Compose 앱 교체/복원을 실행할 수 있어야 한다. 대화형 SSH 터미널에서 `sudo -v`가 성공하고 같은 터미널의 `sudo -n docker version --format '{{.Server.Version}}'`가 이어서 성공하는지 확인한다. `sudo -v`는 각 SSH 단계에서 다시 실행되므로 SSH와 sudo 비밀번호를 여러 번 요청할 수 있다. **무제한 NOPASSWD나 Docker 소켓 권한을 자동 부여하지 않는다.**
- Device Agent: 기존 새 이미지의 `com.tdkon.device-agent-url` label이 있으면 재사용한다. 첫 레이블 없는 이미지에서 출발하는 경우, 실제 POS 브라우저의 Agent URL을 확인하고 로컬 환경변수 `TDK_DEVICE_AGENT_URL`에 `http://127.0.0.1:<포트>`로 한 번 설정한다. 예시 `5168`을 운영 실측값으로 단정하지 않는다. 값이 없거나 다른 형식이면 중단한다.
- 원격 소스: `PrepareRelease`는 로컬과 원격 `main`이 같은 기준에서 출발했을 때만 TDKON 변경을 일반 푸시한다. 원격이 먼저 변경됐거나 푸시가 거부되면 강제 푸시·자동 pull/rebase 없이 중단한다. NAS 단계는 커밋·푸시가 검증된 SHA만 사용한다.

## 이번 작성 작업의 검증 한계

NAS에서 실제 SSH·sudo 비밀번호 입력이 동작함을 확인했다. NAS Compose 5.3.1의 직접 해시는 `env_file`을 빠뜨려 실행 컨테이너 레이블과 달랐고, 해석된 설정의 재해시는 레이블과 일치했다. 실행 이미지 레이블/기준선, 백업 공간, 실제 백업 아카이브와 Docker 복원은 **미검증**이다. `healthy`나 공개 페이지 GET 성공만으로 POS/HOS/QRS의 인증·주문·결제 업무 복구를 선언하지 않는다. 첫 운영 실행 전에 5단계 사전점검 보고서의 미확인 장애 로그와 초대 URL 정책도 해소해야 한다.
