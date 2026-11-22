# QR session `table_id` emergency review — 2026-11-22

## Actual schema (confirmed, read only)

Separate MariaDB 10.11.18 connections were identified with `SELECT DATABASE()` as `TDK_POS_TEST` and `TDK_POS`. `SHOW CREATE TABLE qr_sessions` and `information_schema` show both have `table_id BIGINT(20) UNSIGNED NULL`, `idx_qr_sessions_table_status(table_id,status)`, and a foreign key to `dining_tables(table_id)`. The FK is named `fk_qr_sessions_table_id` in TEST and `fk_qr_sessions_dining_table` in production; its target is the same. No current column, type, nullability, index, or FK mismatch exists.

TEST has 43 closed QR sessions; production has 6 active and 1 closed. All 50 rows have a non-NULL table ID with a valid dining-table reference. All TEST rows that also have a table-session ID refer to the same table. Production QR sessions have no table-session ID; each currently refers to table ID 1. No session backfill is justified. Table ID 8 (display number `8`, name `8번 테이블`) currently has no open table session, QR session, or pending QR order in either DB, so the historical 8T cancellation failure cannot be reproduced from current rows.

`qr_table_links` has 2 rows in TEST and 1 in production, all referencing an existing QR code and dining table. The QR session tables have current sticker mappings (TEST table IDs 1 and 2; production table ID 1). TEST has 20 accepted and 3 rejected QR orders; production has no QR orders. Neither database currently has a pending QR order.

The source's `loadCurrentPendingQrOrderCount` and `loadQrTableIndicators` SQL ran successfully in both databases with no MariaDB 1054 error. Pending count was zero in both; indicators returned zero rows in TEST and one row in production.

## Migration and code (confirmed)

`db-migrations/20261122_qr_sessions_table_id.sql` from `b9d7ab2` defines exactly the column, index, and production FK now present. It is a one-time `ALTER TABLE` and is not idempotent. Running it again would fail on the existing column. The file does not repair partial application; if a later environment differs, inspect that environment and prepare a separate, state-specific repair. The already applied file was left intact.

`src/db/schema.ts` declares the nullable unsigned table ID and composite index. `src/lib/qr-table-indicators.ts` uses `qs.table_id` in its pending-count and per-table indicator queries; POS page and HOS table loader call these queries. The QR customer entry route inserts a session with a table ID. Checkout, table-session closure, and table cancellation use `qrSessions.tableId` to scope session closure. The 8T cancellation route also checks related pending QR orders before updating rows. Query construction uses Drizzle `inArray` for session and table IDs; the current 8T data cannot exercise its authenticated write path.

## Checks performed

- `node node_modules/typescript/bin/tsc --noEmit`: PASS.
- Focused ESLint of schema, POS/HOS, QR indicators, customer entry, checkout, table-session close, and table cancellation: PASS.
- Eight focused unit-test files: 21/21 PASS.
- `node node_modules/next/dist/bin/next build`: PASS. Two pre-existing dynamic filesystem tracing warnings in `menu-image-storage.ts`.
- No authenticated POS/HOS/QRS browser or write API integration test was run. No test QR scan, order, or cancellation was submitted.

## Operating decision and remaining evidence

No production SQL should be executed for the current schema. No NAS deployment is justified by a current schema mismatch. If the incident continues, obtain the running container image/build or Git commit and the matching POS page, HOS table API, 8T cancellation, and QR entry application logs. Look for MariaDB error code, errno, SQLSTATE, and timestamp; compare the log timestamp with the schema change and deployed image. Docker CLI is unavailable on this workstation. Read-only SSH inspection of the NAS was attempted with batch authentication and rejected with `Permission denied (publickey,password,keyboard-interactive)`, so no container logs or running commit were obtained. The historical error and runtime commit therefore remain unconfirmed.

If a future environment is missing the column, first verify `SELECT DATABASE()`, `SHOW CREATE TABLE qr_sessions`, the table PK, existing indexes/FKs, and a current backup. Review the exact one-time migration against that state, then apply schema before deploying code that references `table_id`. MariaDB DDL is not ordinarily rolled back by transaction rollback; recovery requires a verified backup and an explicit follow-up plan. For today's state, there is no DDL rollback because no DDL was applied.

No database, NAS, Docker, Caddy, or application behavior was changed in this review. Existing unrelated working-tree edits were preserved.
