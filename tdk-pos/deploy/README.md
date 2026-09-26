# TDK POS Windows 자동 실행

## POS PC에서 처음 설정하기

1. 평소처럼 저장소를 최신 `main`으로 업데이트하고, `tdk-pos`에 정상 빌드(`.next/BUILD_ID`)와 `.env.local`이 있는지 확인합니다. 이 자동화 파일도 POS PC에 있어야 합니다.
2. Windows에서 실제로 POS를 사용할 계정으로 로그인합니다.
3. PowerShell을 열고 아래 명령을 실행합니다. 관리자 권한은 보통 필요하지 않습니다. 작업 스케줄러 정책상 거부되면 관리자에게 이 명령의 실행을 요청하세요.

   ```powershell
   cd 'D:\10_프로그래밍_소스\01_TDK_Web\tdk-pos'
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\register-pos-task.ps1
   ```

4. `Registered scheduled task: TDK POS Auto Start`가 보이면 등록되었습니다. Windows를 재부팅하고 같은 계정으로 로그인합니다. 로그인 후 POS 전용 Chrome 창이 열리고 `http://localhost:3000/pos`가 표시되는지 확인합니다.
5. 문제가 있으면 `.pos-runtime\logs\pos-updater.log`를 확인합니다. 서버 표준 출력은 `pos-server.log`, 오류 출력은 `pos-server.err.log`에 있습니다. 로그를 외부에 보낼 때는 내용을 먼저 확인하세요.

작업은 **로그인 시** 실행됩니다. 실제 POS 계정으로 로그인해야 서버와 Chrome 창이 시작됩니다. Chrome은 별도 앱 창으로 열리며 기존 Chrome 창을 닫지 않습니다. POS 화면 자체에 전체화면 버튼이 있으므로 kiosk 모드는 사용하지 않습니다.

## 수동 실행과 해제

수동으로 업데이트를 확인하고 실행하려면 `tdk-pos\deploy\start-pos.cmd`를 실행합니다. 현재 서버가 이미 정상 실행 중이면 중복 실행하지 않고 기존 서버를 유지합니다. 현재 서버를 끄고 새 버전을 적용하려면 POS 사용을 마친 뒤 Windows를 재부팅하거나 해당 작업의 실행 프로세스를 종료한 뒤 다시 실행하세요. 모든 `node.exe`를 종료하지 마세요.

자동 실행 스크립트가 시작한 서버만 수동으로 종료하려면 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\stop-pos.ps1`을 실행합니다. 이 스크립트는 기록된 PID, 시작 시각, 3000 포트 점유 PID가 모두 일치할 때만 해당 Node 프로세스를 종료합니다. 이전 버전 스크립트가 시작해 PID 기록이 없는 서버는 건드리지 않습니다.

자동 시작을 해제하려면 다음을 실행합니다.

```powershell
cd 'D:\10_프로그래밍_소스\01_TDK_Web\tdk-pos'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\register-pos-task.ps1 -Unregister
```

## 동작 방식

- 실행 중인 TDK POS를 확인합니다. 이미 정상 응답하면 서버를 하나 더 열지 않습니다. 다른 프로그램이 3000 포트를 점유하면 중지하고 로그에 기록합니다.
- 원본 저장소의 tracked 파일 변경을 확인합니다. 변경이 있으면 자동 업데이트를 건너뛰고 기존 빌드를 사용합니다. `reset --hard`, `pull`, 운영 파일 삭제는 실행하지 않습니다.
- `git fetch origin main` 실패(인터넷 없음 포함) 시 기존 빌드를 실행합니다. 성공하면 현재 실행 버전과 GitHub 커밋을 비교합니다.
- 새 커밋이 있을 때만 `.pos-runtime\releases`에 별도 Git worktree를 만들고, 운영 환경 파일을 복사합니다. 패키지 파일이 같으면 기존 `node_modules`를 재사용하고, 다르면 `npm ci --include=dev`를 실행합니다.
- 후보 버전의 `npm run build`가 성공하고 `.next/BUILD_ID`가 생긴 경우에만 새 서버 시작을 시도합니다. 서버 준비가 확인되어야 활성 버전 정보를 저장합니다. 어느 단계에서든 실패하면 기존 정상 빌드를 시작합니다.
- 메뉴 업로드 이미지의 기본 저장 위치는 원본 `tdk-pos\public\uploads\menu`로 유지됩니다. 기존에 `MENU_IMAGE_STORAGE_PATH`를 따로 설정했다면 그 설정을 따릅니다.
- 로그는 1MB를 넘으면 `pos-updater.previous.log`로 교체됩니다. 서버 로그는 서버 시작 시 새로 작성됩니다. 실패한 후보 폴더와 오래된 성공 버전 폴더는 자동 삭제하지 않으므로 저장 공간이 부족하면 점검 후 정리해야 합니다.

실행 스크립트는 업데이트 대상과 독립적으로 원본 `deploy` 폴더에서 실행됩니다. 이 배포 스크립트 자체가 GitHub에서 바뀐 경우에는 POS PC에서 수동으로 `git pull`하여 스크립트를 갱신해야 합니다. 저장소의 tracked 파일에 로컬 변경이 있으면 먼저 그 변경을 검토하세요.
