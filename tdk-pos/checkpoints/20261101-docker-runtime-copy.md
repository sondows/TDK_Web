# TDKON Docker runtime 누락 재발 방지 체크포인트 — 2026-11-01

상태: 코드 수정 완료, Docker 이미지/컨테이너 검증 BLOCKED.

## 수정

- Dockerfile runtime stage에 `src/lib/owner-setup-mode.cjs` 복사를 추가했다 (`node:node` 소유권 유지).
- `scripts/verify-runtime-files.cjs`를 추가했다. server/kds/recovery CJS 시작점의 정적 require 그래프, package resolution, 구문과 runtime path 존재를 확인한다.
- Dockerfile은 모든 runtime COPY 뒤 검증기를 실행하고 성공 시 `/tmp` 파일을 제거한다.
- USER node, HEALTHCHECK, ingress 보안 환경 설정은 변경하지 않았다.

## 검증

- `node --check` server.cjs, kds-ingress.cjs, owner-setup-mode.cjs, verifier: PASS.
- 로컬 verifier는 이전 `.next/BUILD_ID`가 존재할 때 4개 CJS 파일 의존성 검사 PASS. `npm.cmd run build` 이후 빌드 실패로 BUILD_ID가 없어져 재검사 시 누락을 탐지하고 FAIL-CLOSED.
- `npm.cmd run build`: Google Fonts 다운로드 연결 오류로 실패. Next 설정은 로드.
- Docker/podman/nerdctl/buildah CLI 없음. Docker 이미지, 내부 경로, production 서버, Docker HEALTHCHECK는 미검증.
- 운영 NAS/DB/컨테이너/볼륨 변경 없음.

## 복구

Dockerfile 복구 시 추가된 owner 모듈 COPY와 verifier COPY/RUN만 되돌리면 된다. verifier 소스는 `scripts/verify-runtime-files.cjs`이다. 기존 `tdk-pos:1.0.0` 이미지는 사용하거나 덮어쓰지 않았다.
검증기 보충: 모든 package.json production dependency resolve 검사를 추가했다. production build 실패 후 재실행에서는 .next/BUILD_ID만 없다고 보고하고 fail-closed했다. 다른 파일/패키지 의존성 오류는 없었다.
