# TDKON Windows 시작 및 키오스크 실행

Device Agent와 POS는 현재 별도 로그온 작업으로 실행합니다. 두 작업은 같은 Windows 사용자 계정의 대화형 세션에서 등록해야 합니다.

## 1. Device Agent 자동 시작

먼저 Device Agent를 게시하고 POS PC의 고정된 설치 폴더에 복사합니다. PowerShell에서 실제 실행 파일 경로를 전달해 현재 사용자 로그온 작업을 등록합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<저장소 경로>\tdk-device-agent\deploy\register-device-agent-task.ps1" -AgentExecutable "<설치 경로>\tdk-device-agent.exe"
```

Agent 시작 스크립트는 `127.0.0.1:5168`의 기존 서비스를 확인하고, 이미 응답 중이면 중복 실행하지 않습니다. Agent는 POS Edge를 직접 시작하지 않습니다.

## 2. POS 자동 시작

POS 폴더에서 별도 로그온 작업을 등록합니다. 작업은 로그온 후 12초 대기한 다음 Microsoft Edge를 전체 화면 키오스크 모드로 엽니다.

```powershell
Set-Location "<저장소 경로>\tdk-pos"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\register-pos-task.ps1
```

POS 주소는 `https://tdkon.myasustor.com/tdkpos`이며, POS 전용 Edge 프로필은 `%LOCALAPPDATA%\TDK-POS\EdgeProfile`입니다. 같은 프로필이 이미 실행 중이면 새 창을 만들지 않습니다. 수동 시작은 `deploy\start-pos.cmd`를 실행합니다.

## 3. 작업 해제

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<저장소 경로>\tdk-device-agent\deploy\register-device-agent-task.ps1" -Unregister
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\register-pos-task.ps1 -Unregister
```

`update-and-start-pos.ps1`은 로컬 Next.js 서버의 개발·유지보수 도구로 남겨둡니다. 이 스크립트가 브라우저를 열도록 실행되는 경우에도 POS 화면은 공용 HTTPS 전용 Edge kiosk launcher를 통해 열립니다. Windows 로그온 작업은 `TDK POS Auto Start` 하나만 사용하고, 등록 스크립트는 기존 POS 자동 실행 작업을 XML로 백업한 뒤 중복·구형 작업을 교체합니다.

## 4. 현장 확인

로그아웃 후 같은 Windows 사용자로 다시 로그인하여 Device Agent의 `http://127.0.0.1:5168/` 응답과 POS 전용 Edge 키오스크 창을 각각 확인합니다. Device Agent 종료 API는 `%LOCALAPPDATA%\TDK-POS\EdgeProfile`을 사용하는 해당 사용자 세션의 Edge 프로세스만 대상으로 합니다.
