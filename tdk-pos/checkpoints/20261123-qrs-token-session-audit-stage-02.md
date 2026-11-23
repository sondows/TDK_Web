# TDKQRS invite-only session policy implementation — 2026-11-23

## Scope and safety

- Implemented locally in the TDKON source tree only.
- No database, NAS, Docker/Caddy service, Git commit, or remote branch was changed.
- Existing unrelated worktree modifications were preserved.
- Database integration verification remains pending; the source and focused tests are the current evidence.

## Policy changes

- First POS acceptance now binds only the QR session attached to the accepted order.
- A different customer's unbound pending order remains `PENDING` after another customer opens the table session. POS/HOS show an invite-required explanation and disable approval; staff may still explicitly reject it.
- POS queue and acceptance both enforce the shared six-hour/session expiry predicate. Expired pending orders remain visible and are never auto-rejected or deleted.
- An invite binds the existing active unbound token for the same table, preserving its pending-order association. The prior token is not closed as a side effect. A fresh token is issued when there is no matching live unbound token.
- ADM retire/reassign/type-change operations check pending QR orders for affected tables inside the write transaction and block before changing QR links or closing customer sessions. Table rows are locked in ascending order; QR order submission already locks the table row.

## Files changed

- `src/lib/qr-session-expiry-policy.ts`
- `src/lib/qr-processing-policy.ts`
- `src/lib/qr-processing-policy.test.mjs`
- `src/app/api/pos/qr-table-orders/route.ts`
- `src/app/pos/PosQrTableOrderPanel.tsx`
- `src/app/hos/HosQrPendingOrders.tsx`
- `src/app/tdkqrs/join/[token]/route.ts`
- `src/app/api/admin/qr-codes/route.ts`

## Remaining verification

- PASS — focused QR policy/access tests: 13 tests; API access suite: 25 tests.
- PASS — `tsc --noEmit`, scoped ESLint, and production build. Build emitted two existing dynamic-filesystem tracing warnings from `src/lib/menu-image-storage.ts`.
- PASS — `scripts/verify-qr-entry-development.cjs` against the existing localhost development server and `TDK_POS_TEST`: token issue/reuse and closed-session guard.
- PASS — extended `scripts/verify-qr-invite-development.cjs` with unique synthetic rows in `TDK_POS_TEST`: invited same-table pending session is reused and its pending order remains attached; uninvited pending order is shown as `INVITE_REQUIRED`, PATCH acceptance returns 409 without changing PENDING status; a seven-hour-old session is shown as `EXPIRED`, PATCH acceptance is blocked without changing PENDING status. The script verified the HTTP app database identity as `TDK_POS_TEST` and removed its fixture rows.
- Not covered end-to-end: successful first POS acceptance with two simultaneous pending orders, concurrent duplicate acceptance, or authenticated ADM reassign/retire rejection. The first-order binding policy has focused unit coverage, and ADM guard is implemented inside the transactional API, but those API/database race paths need a dedicated authenticated fixture before claiming full concurrency verification.
- Browser behavior and production/NAS deployment are out of scope and remain unverified.
