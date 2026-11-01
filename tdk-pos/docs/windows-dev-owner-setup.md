# TDKON Windows 개발용 최초 관리자 비밀번호 등록

이 절차는 개발 PC에서 기존 OWNER 계정의 마스터 비밀번호 미등록 상태를 확인할 때만 사용한다. 실제 비밀번호 저장은 ADM 등록창에서 사용자가 직접 수행한다.

1. 프로젝트의 `.env.local`에서 `DB_NAME=TDK_POS_TEST`인지 확인한다. 다른 DB이면 실행 스크립트가 종료된다.
2. Windows PowerShell을 **관리자 권한으로 실행**한다.
3. 프로젝트 루트로 이동하고 `.\scripts\start-windows-owner-setup.ps1`을 실행한다.
4. Chrome에서 `http://localhost:3000/tdkadm/login`을 연다. 다른 장치에서 접속하지 않는다.
5. 등록창 표시만 확인하고, 비밀번호를 설정할 때는 사용자 본인이 직접 입력한다. 이 도구는 비밀번호 입력이나 제출을 수행하지 않는다.
6. Ctrl+C로 개발 서버를 종료한다. 스크립트는 실행 환경 변수를 제거/복구한다. 다음 일반 개발 서버는 Windows 설정 모드 없이 실행한다.

보호 조건:

- 현재 Windows 프로세스 토큰이 로컬 Administrators 그룹에 있어야 한다. 권한이 상승되지 않았으면 스크립트는 실행되지 않는다.
- 설정 모드는 `NODE_ENV=development`, `DB_NAME=TDK_POS_TEST`, `TDK_WINDOWS_DEV_OWNER_SETUP=1`이 모두 맞을 때만 활성화된다.
- ingress가 실제 loopback 소켓과 localhost/127.0.0.1 Host를 확인한 뒤에만 서버 내부 setup attestation을 붙인다. 브라우저가 위조한 헤더와 LAN/인터넷 요청은 허용되지 않는다.
- 운영 환경에서는 Windows 개발 설정 모드가 비활성이다. 기존 NAS 초기 설정 경로는 유지한다.
- 상태 API는 IP별 15분 요청 제한을 유지한다. 제한이 걸리면 카운터를 초기화하거나 우회하지 말고 제한 시간이 지난 뒤 다시 확인한다.
