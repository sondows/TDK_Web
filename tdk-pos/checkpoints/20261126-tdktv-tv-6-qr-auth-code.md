# TDKTV TV-6 QR verification code display — 2026-11-26

## Implementation

- Added `tv_qr_auth_code_state` to Drizzle schema and migration `db-migrations/20261126_tdktv_qr_auth_code_test.sql`.
- Applied the table and its empty singleton row to `TDK_POS_TEST` only. The DB application settings and `DATABASE_URL` both resolved to `TDK_POS_TEST`; no production DB connection was used.
- The test issuer uses `crypto.randomInt(0, 100)`, formats the value as two digits, and serializes issue calls by locking the singleton row in a transaction. Active requests preserve the code and issuance ID and move expiry to DB time + 10 seconds. Expired requests create a new issuance ID.
- Added authenticated no-store status APIs for ADM TV and HOS. Status reads never extend expiry. The test issue API requires ADM authentication and is available only when both `NODE_ENV=development` and `DB_NAME=TDK_POS_TEST`.
- DP1 renders a separate code layer without changing image/timer state. DP2–DP5 are unchanged. TV-4 business notice suppresses the code.
- HOS shows the same shared value in a non-clickable “인증” navigation item; expired values display as `--`.
- Both displays poll once per second. They compare monotonic state versions, reject older responses, and use server time plus request latency when clearing expired values.

## Verification

- `test:tv-auth-code-db`: PASS — real `TDK_POS_TEST` integration covered issuance, two concurrent callers, stable code/issuance ID, status reads without TTL extension, expiry, and new issuance. The singleton row was restored and read back empty after the test.
- `test:api-access`: PASS — 29 tests, including leading-zero formatting, development/test-DB gate, DP1-only rendering, TV-4 priority, stale response rejection, manifest and host access.
- `tsc --noEmit`: PASS.
- Targeted ESLint: PASS.
- Production build: PASS. It retains existing dynamic filesystem tracing warnings from `src/lib/menu-image-storage.ts`.
- Authenticated ADM/HOS browser behavior, actual DP1 video overlay, one-second physical-device synchronization, and network-loss recovery remain unverified.

## Scope

No production DB, NAS, Docker/Caddy, QR order/session, commit, or push changes. A separate approval and production schema application are required before a production rollout.
