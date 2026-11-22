# TDKON 간단 배포

저장소 루트에서 `deploy.bat`를 실행한다.

```cmd
.\deploy.bat
```

스크립트는 TDKON 파일만 검사해 커밋·푸시하고, NAS에서 `git pull --ff-only origin main`, `docker compose build tdk-pos`, `docker compose up`을 순서대로 실행한다. 새 컨테이너가 healthy가 될 때까지 기본 상태만 확인한다. SSH와 NAS sudo 비밀번호는 터미널에서 직접 입력한다.

이미지 백업과 자동 롤백은 하지 않는다. 빌드가 실패하면 기존 컨테이너 교체 전에 멈춘다. 컨테이너 교체나 시작이 실패하면 서비스가 멈출 수 있으므로 NAS 로그를 확인하고 오류를 수정한 뒤 `deploy.bat`를 다시 실행한다. NAS Git checkout이 이미 새 커밋이어도 재빌드할 수 있다.

POS Device Agent 주소는 별도 설정이 없으면 Dockerfile 기본값 `http://127.0.0.1:5168`을 사용한다. 실제 POS PC가 다른 포트를 사용한다면 배포 CMD 창에서 다음을 먼저 실행한다.

```cmd
set "TDK_DEVICE_AGENT_URL=http://127.0.0.1:실제포트"
```

커밋·푸시까지만 실행할 때는 `deploy.bat -Mode PrepareRelease`를 사용한다. 이미지 백업·롤백이 필요한 경우에만 `deploy.bat -Mode Guarded`를 사용한다. 어느 경로도 운영 DB 스키마를 변경하지 않는다.
