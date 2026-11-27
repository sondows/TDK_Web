# TDKQRS QR-1 current-visit order history — 2026-11-27

## Result

QR-1 is implemented locally. Table QR entry now routes directly to order history when the current open table visit already contains POS orders; otherwise it routes to the menu. All valid QR customers may read the current visit's POS and approved QR orders and aggregate summary without receiving invite or representative permissions.

## Scope and safeguards

- Read visibility is scoped to exactly one open `DINE_IN` visit for the scanned table.
- A bound QR token remains pinned to its own `table_session_id`; it cannot read a later visit.
- Multiple open visits fail closed with `SESSION_CONFLICT`.
- The API confirms the selected visit remains open before returning history; if it ended during the request, the API returns `VISIT_ENDED` without order data.
- `canViewCurrentVisitOrders` controls history and aggregate display. Existing `canViewOrders` continues to control invite and representative privileges.
- QR scan does not bind a QR session, create a TV-7 claim, or change first-order code verification, representative policy, HOS approval, or COMPLETE handlers.
- No schema or DB migration was required.

## Verification

- `scripts/verify-qr-entry-development.cjs`: PASS against `TDK_POS_TEST`; simultaneous independent QR tokens, direct history routing for a POS-first visit, current POS orders visible without claims/binding, and no prior POS orders after visit close. Temporary fixtures were removed.
- `scripts/verify-qr-invite-development.cjs`: PASS against the local server / `TDK_POS_TEST`.
- QR policy tests: 16/16 PASS.
- TypeScript `--noEmit`: PASS.
- Focused ESLint: PASS.
- Production build: FAILS before route compilation at existing `src/app/pos/CustomerBalanceDialog.module.css:131`, where CSS Modules reject the global selector `body *`. That unrelated file was left unchanged. The isolated build copy kept the running development server's `.next` directory untouched.
- Physical mobile browser verification: not performed.

No operating DB access or changes, NAS deployment, Docker/Caddy restart, Git commit, or push occurred. QR-2 and later stages were not started.
