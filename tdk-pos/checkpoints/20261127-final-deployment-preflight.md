# TDKON Final Deployment Preflight - 2026-11-27

Status: **BLOCKED**. The NAS TV image host directory is absent, backups are unverified, and container replacement has no approval.

## Verified state

- User-provided NAS output: container tdk-pos-tdk-pos-1 is running and healthy, restart policy unless-stopped, image sha256:d3ea46a9631243b0ea884e5bc702e61ecd581ce36d38a349144e56e5ca4ad211.
- The container runs as node (UID/GID 1000:1000). Its old /app/.pos-runtime/tdktv-images folder is absent. Existing mounts are menu, QR notices, QR title, and receipt logo. No TV mount exists.
- /volume1/TDK-POS/tdk-pos/storage/tdktv-images and /volume1/tdk-pos-release-backups are absent. The production DB had zero TV image rows at the last inspection.
- Direct SSH and direct website access from this workspace failed. The NAS app DB account, actual production environment values, and backup contents remain unverified.
- Local main HEAD: 944e0d4717a7a5392ecc0a25442fa7ca989a5544. No staging, commit, push, NAS change, or container replacement occurred.

## Release procedure and approval boundaries

- The default deploy.bat Auto mode calls prepare-release.ps1, which commits and pushes all TDKON changes, then simple-release.ps1, which builds and replaces the NAS container. Do not run it during preflight.
- To separate approvals, review the file list below first, then explicitly authorize prepare-release.ps1 for Git commit/push. After backups, host directory preparation, and a separate container-replacement approval, run simple-release.ps1 against the clean committed main.
- The simple NAS release has no image archive or automatic rollback. Preserve the running image ID, old Compose and environment files, and uploaded assets before replacement. Do not overwrite live DB orders or payments with an old backup during code rollback.
- First deploy with TDK_QR_ORDER_AUTH_ENABLED=false. Enable it only after base POS/HOS/KDS/ADM/QRS and DP1-DP5 checks, using a separately authorized test table and orders.

## Local checks

TypeScript, focused ESLint, 30 API access tests, 10 QR/TV policy tests, local production build, Compose YAML parse, TV bind-mount assertion, and NAS helper shell syntax passed. Two existing menu-image path tracing warnings appeared during build. NAS docker compose config and current TV-7C/7D HTTP/DB tests were unavailable.

## Prepared NAS commands (not executed; require separate approvals)

After permission to prepare the storage directory, run each command separately in NAS SSH. Stop on any error and verify the exact path before the next command:

```sh
sudo mkdir -p /volume1/TDK-POS/tdk-pos/storage/tdktv-images
sudo chown 1000:1000 /volume1/TDK-POS/tdk-pos/storage/tdktv-images
sudo chmod 750 /volume1/TDK-POS/tdk-pos/storage/tdktv-images
ls -ld /volume1/TDK-POS/tdk-pos/storage/tdktv-images
```

After separate permission to create recovery files, recheck that the running image ID is unchanged, then preserve that exact image and the current configuration. The backup archive is under the existing project `storage` tree and requires sufficient NAS free space:

```sh
cd /volume1/TDK-POS/tdk-pos
sudo docker inspect -f '{{.Image}}' tdk-pos-tdk-pos-1
sudo docker image tag sha256:d3ea46a9631243b0ea884e5bc702e61ecd581ce36d38a349144e56e5ca4ad211 tdk-pos:pre-tv7-20261127
sudo docker save -o storage/tdk-pos-pre-tv7-20261127.tar tdk-pos:pre-tv7-20261127
sudo sha256sum storage/tdk-pos-pre-tv7-20261127.tar
sudo cp -p docker-compose.yml storage/docker-compose.pre-tv7.yml
sudo cp -p .env.production storage/env.production.pre-tv7
sudo chmod 600 storage/env.production.pre-tv7
```

Before running `simple-release.ps1`, the reviewed release must already be committed and pushed, and the checkout must be clean. That script builds and replaces the app container. Do not use `deploy.bat` to review the release: it also commits and pushes. If replacement fails, restore the saved image tag and saved Compose/environment files, then recreate only `tdk-pos`; never restore an old DB snapshot over live orders or payments. Confirm the actual backup archive and old image ID before issuing any restore command.

## Current automatic commit candidates (116 paths)

This is git status --porcelain=v1 --untracked-files=all for deploy.bat and tdk-pos, excluding .local-dev-https. Recompute immediately before any approval. It includes earlier QR/TV work, tests, docs, and SQL files.

```text
M tdk-pos/.env.production.example
 M tdk-pos/Dockerfile
 M tdk-pos/PLANS.md
 M tdk-pos/docker-compose.yml
 M tdk-pos/package.json
 M tdk-pos/scripts/verify-qr-entry-development.cjs
 M tdk-pos/src/app/admin/AdminSidebar.tsx
 M tdk-pos/src/app/admin/qr-codes/QrCodeManager.tsx
 M tdk-pos/src/app/api/admin/qr-codes/export/route.ts
 M tdk-pos/src/app/api/admin/qr-codes/route.ts
 M tdk-pos/src/app/api/checkouts/route.ts
 M tdk-pos/src/app/api/pos/qr-table-orders/route.ts
 M tdk-pos/src/app/api/qr/order-invites/route.ts
 M tdk-pos/src/app/api/qr/staff-table-token/route.ts
 M tdk-pos/src/app/api/qr/table-orders/route.ts
 M tdk-pos/src/app/api/table-sessions/[sessionId]/route.ts
 M tdk-pos/src/app/hos/HosHome.tsx
 M tdk-pos/src/app/qr/QrMenuClient.tsx
 M tdk-pos/src/app/qrorder/QrOrderHistory.tsx
 M tdk-pos/src/app/qrorder/order/page.tsx
 M tdk-pos/src/app/tdkqrs/[identifier]/route.ts
 M tdk-pos/src/app/tdkqrs/join/[token]/route.ts
 M tdk-pos/src/db/schema.ts
 M tdk-pos/src/lib/admin-navigation.test.mjs
 M tdk-pos/src/lib/admin-navigation.ts
 M tdk-pos/src/lib/api-route-manifest.json
 M tdk-pos/src/lib/api-route-manifest.test.mjs
 M tdk-pos/src/lib/auth.ts
 M tdk-pos/src/lib/host-access.test.mjs
 M tdk-pos/src/lib/host-access.ts
 M tdk-pos/src/lib/qr-cooking-progress.test.mjs
 M tdk-pos/src/lib/qr-cooking-progress.ts
 M tdk-pos/src/lib/qr-order-auth.ts
 M tdk-pos/src/lib/qr-processing-policy.test.mjs
 M tdk-pos/src/lib/qr-processing-policy.ts
 M tdk-pos/src/lib/qr-session-expiry-policy.ts
 M tdk-pos/src/lib/qr-table-indicators.ts
 M tdk-pos/src/lib/qr-unified-order-rounds.test.mjs
 M tdk-pos/src/lib/qr-unified-order-rounds.ts
?? tdk-pos/checkpoints/20261125-qr-multicustomer-stage-03.md
?? tdk-pos/checkpoints/20261125-qr-order-history-stage-04.md
?? tdk-pos/checkpoints/20261126-tdkqrs-tv-7a.md
?? tdk-pos/checkpoints/20261126-tdkqrs-tv-7b.md
?? tdk-pos/checkpoints/20261126-tdkqrs-tv-7c.md
?? tdk-pos/checkpoints/20261126-tdkqrs-tv-7d.md
?? tdk-pos/checkpoints/20261126-tdktv-stage-01.md
?? tdk-pos/checkpoints/20261126-tdktv-stage-05.md
?? tdk-pos/checkpoints/20261126-tdktv-tv-6-qr-auth-code.md
?? tdk-pos/checkpoints/20261126-tdktv-tv5-overlay.md
?? tdk-pos/checkpoints/20261127-deployment-stage-04.md
?? tdk-pos/checkpoints/20261127-deployment-stage-05.md
?? tdk-pos/checkpoints/20261127-final-deployment-preflight.md
?? tdk-pos/db-migrations/20261124_qr_code_preparations_test.sql
?? tdk-pos/db-migrations/20261125_qr_session_access_grants_test.sql
?? tdk-pos/db-migrations/20261125_qr_table_order_claims_test.sql
?? tdk-pos/db-migrations/20261126_qr_order_auth_attempts_test.sql
?? tdk-pos/db-migrations/20261126_qr_order_auth_session_snapshot_test.sql
?? tdk-pos/db-migrations/20261126_tdktv_business_notice_test.sql
?? tdk-pos/db-migrations/20261126_tdktv_dp_identifiers_test.sql
?? tdk-pos/db-migrations/20261126_tdktv_image_events_test.sql
?? tdk-pos/db-migrations/20261126_tdktv_qr_auth_code_test.sql
?? tdk-pos/db-migrations/20261126_tdktv_sync_layout_test.sql
?? tdk-pos/db-migrations/20261126_tdktv_test.sql
?? tdk-pos/db-migrations/20261126_tdktv_transition_effect_test.sql
?? tdk-pos/db-migrations/20261127_tdktv_production_migration_notes.md
?? tdk-pos/db-migrations/20261127_tdktv_production_postcheck.sql
?? tdk-pos/db-migrations/20261127_tdktv_production_preflight.sql
?? tdk-pos/db-migrations/20261127_tdktv_production_schema.sql
?? tdk-pos/db-migrations/20261127_tv7_production_preflight.sql
?? tdk-pos/scripts/apply-qr-order-auth-session-snapshot-test.mjs
?? tdk-pos/scripts/check-tv-notice-table.cjs
?? tdk-pos/src/app/admin/(protected)/tv/TvManagementClient.tsx
?? tdk-pos/src/app/admin/(protected)/tv/events/TvEventsClient.tsx
?? tdk-pos/src/app/admin/(protected)/tv/events/page.tsx
?? tdk-pos/src/app/admin/(protected)/tv/images/page.tsx
?? tdk-pos/src/app/admin/(protected)/tv/notice/TvNoticeClient.tsx
?? tdk-pos/src/app/admin/(protected)/tv/notice/page.tsx
?? tdk-pos/src/app/admin/(protected)/tv/page.tsx
?? tdk-pos/src/app/admin/(protected)/tv/playback/page.tsx
?? tdk-pos/src/app/api/admin/tdktv/events/route.ts
?? tdk-pos/src/app/api/admin/tdktv/images/[imageId]/file/route.ts
?? tdk-pos/src/app/api/admin/tdktv/notice/route.ts
?? tdk-pos/src/app/api/admin/tdktv/qr-auth-code/test/route.ts
?? tdk-pos/src/app/api/admin/tdktv/route.ts
?? tdk-pos/src/app/api/hos/qr-auth-code/route.ts
?? tdk-pos/src/app/api/qr/order-auth/route.ts
?? tdk-pos/src/app/api/qr/order-auth/verify/route.ts
?? tdk-pos/src/app/api/qr/staff-table-token/route.test.mjs
?? tdk-pos/src/app/api/tdktv/[screenCode]/route.ts
?? tdk-pos/src/app/api/tdktv/images/[imageId]/route.ts
?? tdk-pos/src/app/api/tdktv/qr-auth-code/route.ts
?? tdk-pos/src/app/tdktv/[screenCode]/page.tsx
?? tdk-pos/src/app/tdktv/[screenCode]/player.tsx
?? tdk-pos/src/lib/qr-order-auth-attempt-policy.test.mjs
?? tdk-pos/src/lib/qr-order-auth-attempt-policy.ts
?? tdk-pos/src/lib/qr-table-order-claim-policy.test.mjs
?? tdk-pos/src/lib/qr-table-order-claim-policy.ts
?? tdk-pos/src/lib/qr-table-order-claims.ts
?? tdk-pos/src/lib/tdktv-event-rendering.test.mjs
?? tdk-pos/src/lib/tdktv-event-rendering.ts
?? tdk-pos/src/lib/tdktv-policy.test.mjs
?? tdk-pos/src/lib/tdktv-policy.ts
?? tdk-pos/src/lib/tdktv-qr-auth-code-policy.test.mjs
?? tdk-pos/src/lib/tdktv-qr-auth-code-policy.ts
?? tdk-pos/src/lib/tdktv-qr-auth-code.ts
?? tdk-pos/src/lib/tdktv-storage.ts
?? tdk-pos/src/lib/use-tv-qr-auth-code.ts
?? tdk-pos/tests/qr-code-preparation-db.integration.mjs
?? tdk-pos/tests/qr-multicustomer-db.integration.mjs
?? tdk-pos/tests/qr-order-auth-attempts-db.integration.mjs
?? tdk-pos/tests/qr-table-order-claims-db.integration.mjs
?? tdk-pos/tests/qr-tv7c-http.integration.mjs
?? tdk-pos/tests/qr-tv7c-schema-check.mjs
?? tdk-pos/tests/qr-tv7d-http.integration.mjs
?? tdk-pos/tests/tdktv-auth-code-db.integration.mjs
?? tdk-pos/tests/tdktv-auth-code-ts-loader.mjs
```
