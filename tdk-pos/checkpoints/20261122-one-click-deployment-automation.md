# TDKON `deploy.bat` 원클릭 안전 배포 자동화 결과

기준일: 2026-11-22 (KST). 이전 4·4.5·5단계 보고서와 현재 배포 코드를 검토했다. 이번 작업은 **로컬 스크립트·테스트·문서만 수정**했다. NAS 이미지 백업/태그/배포, 컨테이너 재시작, 운영 DB 변경, Git 커밋·푸시·초기화는 하지 않았다.

## A. 실제 수정 파일

| 파일 | 변경 |
|---|---|
| `../../deploy.bat` | 인자 없이 실행하면 `-Mode Auto`로 진입; 명시적 수동 모드는 유지 |
| `deploy/release.ps1` | 기본 모드에 `Auto`를 추가하고 기존 `DryRun`/`Deploy` 엄격 경로 보존 |
| `deploy/auto-release.ps1` | Git·NAS 자동 조회, 경로/임시 인덱스 검사, 로컬 검사, 백업 준비, SHA 최종 승인, 배포 후 HTTPS 검사와 필요 시 롤백 |
| `deploy/nas-release.sh` | 읽기 전용 `inspect`, 백업 전용 `prepare`, 별도 승인 `register-baseline`, 기존 `deploy`/`rollback`의 이미지·설정/health/GET·오류 검사 강화 |
| `deploy/test-nas-release.sh` | 임시 가짜 NAS/Docker에서 백업·무결성·복원·실패 경로 검증 |
| `deploy/ONE-CLICK-RELEASE.md` | 실행 방법, 초기 기준선, SSH/sudo 설정, 제한사항 |
| `PLANS.md`, 이 보고서 | 단계와 검증 증거 |

기존 QR 앱 변경과 그 밖의 사용자 미커밋 파일은 수정·스테이징·폐기하지 않았다.

## B. 자동화 결과

| 항목 | 결과 |
|---|---|
| 로컬 Release SHA 자동 조회 | **성공**: `main` HEAD `b9d7ab256964218eb88642954f5a8d4c20bc3d8f`를 전체 40자리로 표시. **이 커밋은 현재 미커밋 복구 수정과 새 배포 도구를 포함하지 않아 승인된 릴리스가 아니다.** |
| NAS Base SHA/컨테이너/이미지 조회 | **코드 구현, 운영 미검증**: 실제 이미지 revision label 또는 승인된 이미지 ID 기준선 기록만 신뢰한다. NAS Git HEAD·Compose config hash·현재 불변 이미지 ID를 교차 검증한다. 레이블/기준선 없으면 중단한다. 태그 `tdk-pos:1.0.0`으로 SHA를 추정하지 않는다. |
| 변경 파일·manifest | **코드 구현**: `NAS_BASE..RELEASE`의 전체 경로를 출력하고 TDKON 밖 변경을 거부한다. 임시 Git 인덱스의 `git diff --cached --check`와 경로 manifest 생성·재확인·SHA-256을 수행한다. 사용자는 파일 목록을 본 뒤 전체 릴리스 SHA를 입력해야 한다. |
| 백업 | **격리 검증 성공, 운영 미검증**: 현재 이미지 ID의 tar·체크섬, Compose/.env/컨테이너 inspect 보호 복사, 별도 백업 태그, 공간·설정 해시 확인. 기존 백업 손상과 이미지 저장 실패는 중단. 현재 NAS에서 백업을 생성하지 않았다. |
| 롤백 | **격리 검증 성공, 운영 미검증**: 시작/health/로컬 POS·HOS·QR GET/주요 오류 로그/공개 HTTPS 검사 실패 시 이전 이미지·설정 복원. 실제 NAS에서 컨테이너를 교체하거나 복원하지 않았다. 격리 시험은 가짜 Docker 명령으로 수행해 실제 복구 성공을 증명하지 않는다. |
| 승인 화면 | **코드 구현**: 검사·백업 후 이미지 ID, 기준/신규 SHA, 경로 수와 manifest 해시, Device Agent URL, 미실시 복원 시험을 표시. 전체 SHA 재입력 전에는 앱 교체 안 함. 승인 전 NAS 백업 준비는 **NAS 쓰기**임을 문서에 명시했다. |
| 현재 `deploy.bat` 실행 | **안전 중단 확인**: 빈 입력은 취소. `EXISTING`을 선택해도 현재 배포 도구가 미커밋이라 중단. 실제 NAS에 접근하거나 배포하지 않았다. |

## C. 보안과 권한

- 수동 비밀번호 SSH 로그인 성공은 **사용자 제공 정보**다. 이번 비대화형 읽기 전용 SSH 확인은 `Permission denied (publickey,password,keyboard-interactive)`였으므로 Codex가 운영 NAS에 인증됐다고 보고하지 않는다. 자동 경로는 호스트 키 검증을 유지하며 비밀번호를 소스·인자·로그에 저장하지 않는다. Windows 콘솔에서 비밀번호를 입력할 수 있지만 여러 SSH 연결에서 반복될 수 있어 승인된 전용 SSH 키가 권장된다.
- `sudo -n docker`와 제한된 백업 작업 권한을 요구한다. 사용자 일반 `sudo docker ps` 성공은 `sudo -n` 성공의 증거가 아니다. 이 작업에서는 NAS sudoers, SSH 키, Docker 소켓 권한을 바꾸지 않았다. 광범위한 Docker sudo 권한은 강한 권한이므로 NAS 관리자가 최소 권한 방식을 검토해야 한다. 불가능하면 자동 배포는 멈춘다.
- 이전 이미지가 SHA label을 갖지 않으면 독립 증거로 이미지 ID↔커밋을 확인하고 **별도 승인 후** `register-baseline`으로 제한된 기준선 기록을 만든다. 가짜 SHA나 NAS Git HEAD를 자동 대입하지 않는다. 현재 실제 이미지의 레이블/기준선 유무는 미확인이다.
- 스크립트는 Git 자동 add/commit/push/reset을 하지 않는다. 기본 실행 검사 당시 작업 트리 전체 1321개 변경 중 TDKON 범위 29개가 출력됐고 그대로 보존됐다. 보고서 파일 생성 후 개수는 달라질 수 있다. 소스나 배포 도구가 미커밋이면 커밋된 릴리스의 로컬 검증이 불가능하므로 교체 전에 중단한다.

## D. 검증 결과

| 검사 | 결과 |
|---|---|
| PowerShell 두 파일 파서, POSIX `sh -n` | 통과 |
| 기본 `.\deploy.bat` 취소, `EXISTING` 선택 후 미커밋 도구 차단 | 통과, 종료 코드 1, NAS 호출 없음 |
| 기존 수동 `-Mode DryRun` | 임시 인덱스 `Validate staged deployment paths: PASS` 후 미커밋 경로 차단, 종료 코드 1 |
| 가짜 NAS 통합 검사 | `inspect`, 아카이브 체크섬, rollback, 손상 백업 거부, `docker save` 실패 거부, rollback 재시작 실패 보고, 잘못된 SHA 거부, 승인 기준선 조회, sudo 거부 통과 |
| TypeScript, 변경 앱 ESLint | 통과 |
| QR 관련 단위 테스트 10파일 | 28/28 통과 |
| `TDK_POS_TEST` 일반 QR·초대 합류 HTTP 통합, 취소 범위·롤백 | 통과; 테스트 행 정리/트랜잭션 롤백 |
| Next.js 16.3.5 프로덕션 빌드 | 종료 코드 0. 기존 `menu-image-storage.ts` 동적 경로 추적 경고 2건. 앞선 출력 필터 파이프의 종료 코드 1은 전체 빌드 재실행으로 확인했다. |
| 실제 NAS SSH→sudo→Docker, 이미지 아카이브/복원, 최종 승인→운영 전환 전체 | **미검증**. 이번 작업에서 실행 금지. |

## E. 사용자에게 필요한 작업

1. 현 미커밋 앱 수정과 배포 도구의 **정확한 릴리스 범위**를 별도 깨끗한 체크아웃에서 검토·커밋·푸시한다. 이 작업에서는 하지 않았다. `git status --short -- deploy.bat tdk-pos`로 현재 파일을 확인한다. NAS 운영 로그·POS/HOS/8T 원인과 5단계 배포 차단 조건을 먼저 해소한다.
2. 승인된 계정에서 `ssh -p 22 sondows@192.168.0.83`로 로그인하고 호스트 키와 기존 키 등록을 확인한다. NAS 관리자와 `ssh -p 22 sondows@192.168.0.83 'sudo -n docker version --format "{{.Server.Version}}"'`의 성공 여부를 확인한다. 실패 시 권한을 임의로 확대하지 않는다.
3. 현재 NAS 이미지 ID, 실제 소스 SHA, 레이블/Compose 설정, 백업·복원 증거를 확인한다. 레이블이 없는 기존 이미지에는 과거 배포 기록으로 연결을 검증한 후 별도 승인된 기준선 등록이 필요하다. `deploy/ONE-CLICK-RELEASE.md`의 절차를 따른다. 실제 POS Device Agent URL도 확인해 필요 시 `TDK_DEVICE_AGENT_URL`을 설정한다.

## F. 최종 실행 방법과 판단

위 선행 조건이 갖춰지면 저장소 루트에서 **`.\deploy.bat`**만 입력한다. 스크립트가 Release SHA와 NAS 기준을 자동 조회하고 검사·백업 후 전체 SHA로 최종 승인을 받는다. 현재 작업 트리에서는 **미커밋 도구/소스 때문에 의도적으로 중단**한다. NAS 이미지의 신뢰 가능한 버전, `sudo -n`, 실제 백업/복원, 운영 장애 로그가 아직 미확인인 상태에서 배포 가능 판정은 내리지 않는다. 이번 작업으로 운영 애플리케이션이나 DB는 변경되지 않았다.

### 2026-11-22 후속 변경

사용자 요청에 따라 `deploy.bat`의 자동 경로 앞에 `PrepareRelease` 단계를 추가했다. 이 단계는 TDKON 범위만 임시 인덱스로 미리 검사하고, 로컬 빌드·TEST 통합 검사를 통과한 뒤 실제 인덱스에 동일한 파일만 올려 커밋·일반 푸시한다. 이 문서의 위쪽 결과는 최초 자동화 작성 시점의 기록이다. 운영 NAS 교체와 DB 변경은 이 후속 준비 단계에 포함되지 않는다.
