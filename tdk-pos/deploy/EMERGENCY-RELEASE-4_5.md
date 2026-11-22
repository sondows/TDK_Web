# TDKON QR recovery release procedure (prepared, not executed)

The 4.5/5 task changes local source and deployment tooling only. Stage 5 needs separate approval for a specific release SHA, file list, NAS base SHA, backup evidence, and production smoke-test scope. See `../checkpoints/20261122-emergency-recovery-stage-04_5.md` for validation evidence and remaining unknowns.

## Release inputs

1. Read the running NAS container image ID, container/image creation times, NAS checkout SHA, `/app/.next/BUILD_ID`, and the relevant application/Caddy logs using the read-only commands in the stage 4 report. The NAS checkout SHA becomes `NAS_BASE_SHA`; do not infer it from an image tag.
2. Fix or explicitly resolve any POS/HOS/8T error found in the logs. Confirm production `TDK_POS` and the existing QR column/index/FK. Do not rerun `20261122_qr_sessions_table_id.sql`.
3. Commit the reviewed app and tooling changes in an isolated clean release checkout. The original dirty worktree can remain untouched. Record the full 40-character `APPROVED_SHA` on `main`, and compare **every** path between `NAS_BASE_SHA` and `APPROVED_SHA`. Place the exact path list, one repository-relative path per line, in a manifest outside `tdk-pos`; no path may be omitted or added. The script never stages, commits, or pushes changes.
4. Verify an existing `TDK_POS` backup checksum and isolated restore record. Confirm NAS free space for the previous image archive and Docker build. Confirm the actual POS Device Agent browser URL (for example, `http://127.0.0.1:5168`), the HTTPS/Caddy proxy headers, the QR public origin, and protected NAS `.env.production` settings without printing secrets.
5. Ensure `origin/main` already equals the approved release SHA and that the NAS SSH account can use key authentication and noninteractive `sudo -n`. The script fails closed otherwise.

## Local scope check

Run from the repository root in the **clean release checkout**:

```powershell
.\deploy.bat -Mode DryRun -ApprovedSha <APPROVED_SHA> -BaseSha <NAS_BASE_SHA> -ApprovedPathsFile <ABSOLUTE_MANIFEST_PATH>
```

DryRun reads local Git only. It prints the committed path list, compares the approved manifest, uses a temporary Git index for `Validate staged deployment paths`, and rejects uncommitted files under `deploy.bat` or `tdk-pos`. It performs no SSH, push, NAS, Docker, or DB operation. A failure on the current dirty worktree is expected and does not alter it.

## Approved deployment

Only after stage 5 approval and backup checks:

```powershell
.\deploy.bat -Mode Deploy -ApprovedSha <APPROVED_SHA> -BaseSha <NAS_BASE_SHA> -ApprovedPathsFile <ABSOLUTE_MANIFEST_PATH> -ConfirmationSha <APPROVED_SHA> -DeviceAgentUrl http://127.0.0.1:5168
```

The script asks for the approved SHA once more. It requires `origin/main` to match, then sends `deploy/nas-release.sh` over SSH. On the NAS, the helper verifies the running DB name, saves the **running image ID** to a new release-specific archive and checksum under `/volume1/tdk-pos-release-backups/<APPROVED_SHA>/`, and saves the exact Compose and `.env.production` files with restricted permissions. It updates NAS Git only by fast-forward, builds from `git archive <APPROVED_SHA>` in a temporary directory, labels the candidate image with its commit SHA, and replaces the app container only after the image and backup checks pass. The temporary build directory is removed; Docker images, volumes, Caddy, and DB rows are not deleted.

The NAS helper waits for the expected new image ID to become healthy. If startup or health fails, it restores the saved image and configuration and recreates only the app container. A healthy result still requires manual POS/HOS/QRS functional checks. An SSH/Sudo, backup, Git, or build failure before container replacement leaves the running container in place; inspect NAS state before retrying.

## Manual rollback after a functional failure

From an authorized NAS shell, using the **same approved SHA**:

```sh
cd /volume1/TDK-POS/tdk-pos || exit 1
sh deploy/nas-release.sh rollback <APPROVED_SHA>
```

Rollback verifies the saved archive checksum, loads the old image if needed, restores the saved Compose/environment files, recreates only `tdk-pos`, and compares the resulting image ID with the saved immutable ID. It waits for the old container healthcheck. Then verify POS/HOS/QRS and the error logs manually. Existing orders, payments, QR sessions, MariaDB data, mounted uploads, and Caddy settings must stay intact; do not restore an old DB snapshot over live data.

After rollback, the NAS Git checkout can still point at the new release commit while the old image runs; a restored Compose file can also make that checkout dirty. Record this state and reconcile it deliberately before another deployment. Do not run `git reset --hard` or clean the NAS worktree as part of rollback.

This rollback command has **not** been exercised on the NAS or in local Docker because NAS SSH authentication was denied and Docker is absent locally. Do not treat syntax and dry-run tests as proof of a successful NAS rollback. Keep the old image archive and protected configuration backup until the production release has been verified.
