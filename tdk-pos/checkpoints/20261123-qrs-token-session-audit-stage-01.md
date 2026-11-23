# TDKQRS QR token/session isolation audit — 2026-11-23

## Scope and safety

- Read-only source review and SELECT-only metadata/aggregate queries against `TDK_POS_TEST` and `TDK_POS`.
- Both DB sessions used `SET TRANSACTION READ ONLY`; each transaction was rolled back.
- No token values or hashes, customer order details, or table identifiers were selected for the report.
- No code, DB rows, NAS services, or Git history were changed.
- The audited source is the current local worktree. The exact running production application revision was not established in this step.

## QR credential types

| Credential | Creation and storage | Scope and lifetime |
|---|---|---|
| Printed QR identifier | 16-character public routing value in `qr_codes`; current table mapping in `qr_table_links` | Resolves the currently assigned table QR. It is not customer authorization. |
| Customer QR access token | 32 random bytes, base64url; SHA-256 hash in `qr_sessions.token_hash`; raw token in `tdkon_qr_session` cookie | One browser credential. `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, `Path=/`; unbound token max age 6 hours. Bound tokens expire at the first accepted QR order's root-token creation time plus 6 hours. |
| Invite token | 32 random bytes, base64url; SHA-256 hash in `qr_session_invites.token_hash`; raw value appears in `/tdkqrs/join/{token}` | Bearer invitation to one open table-use session. Expiry is capped by the shared session expiry; revocation follows session close. `redeemed_at` is recorded but does not make the link single-use; reuse up to capacity is implemented. |
| Visit/wait tokens | Separate `qr_visit_sessions` and `qr_wait_orders` credentials/cookies | Guest/waiting flows; they do not authorize `/api/qr/table-orders`. |
| Development test token | `devtest_` prefix and separate cookie | Accepted only in development against `TDK_POS_TEST`; 30-minute maximum. |

## Entry, reuse, and order-history authorization

1. `GET /tdkqrs/{identifier}` validates the public identifier, its current QR assignment/status, and table activity.
2. It reuses a customer credential only when the browser already presents a valid customer cookie whose resolved `tableId` equals this QR's current table. A valid cookie resolved to another table is rejected; the route does not search for another customer's active token by table ID.
3. Without a valid matching cookie, the route creates a new random token row with `session_id = NULL` and the scanned `table_id`. If a DINE_IN `table_sessions` row is already OPEN, it redirects to `join-required`; otherwise it redirects to ordering.
4. `resolveQrOrderRequest` hashes the cookie value and requires an ACTIVE QR session, active table, current in-use table QR, correct session/table state, and server-side expiry. The QR sticker identifier alone cannot call the order-history API.
5. `GET /api/qr/table-orders` scopes an unbound credential to its own `qr_session_id`. A bound credential reads QR orders associated with that exact `table_sessions.session_id`, plus that session's POS summary. It does not query by `table_id` alone. Responses are `no-store`.
6. When a new device scans while a table-use session is open, the new token remains unbound and the scan enters `join-required`. A valid invite creates a separate customer token bound to the invite's open session; this is the normal cross-device sharing path.

## Confirmed implementation mismatch: first-order auto-binding

When POS accepts the first QR order for an otherwise empty table, `PATCH /api/pos/qr-table-orders` selects **all** ACTIVE, unbound QR sessions for that table that have at least one PENDING order. If the submitted order's session is among them, it creates one table-use session and binds every selected session to it. Subsequent history reads for each bound token include all QR orders in that shared session.

The existing pure policy test explicitly expects this behavior (“pending unbound QR orders for one empty table can join the first accepted table session”). Therefore two phones that each submit an order before the first POS acceptance can have different tokens but become members of one history scope without using an invite. A second phone that only scans, or scans after the first table session is already open, is not auto-bound. This is the clearest source-level path for cross-phone history sharing beyond the stated “join by invite” design; the product/security policy needs confirmation before changing it.

## Expired pending-order handling risk

Customer authorization rejects an unbound token older than six hours. The POS pending-list query and the POS accept transaction, however, check `qr_sessions.status = ACTIVE` and order state but do not apply that token-age predicate. Thus an expired row that remains ACTIVE with a PENDING order can still appear in the POS queue and be accepted. An accepted session rooted in such a stale token can have an already-expired six-hour customer session lifetime.

Read-only current aggregate counts:

| Database | Active unbound QR sessions | Older than 6h | Active unbound sessions with pending order | Stale active + pending | Open DINE_IN sessions | Active unexpired invites |
|---|---:|---:|---:|---:|---:|---:|
| `TDK_POS_TEST` | 3 | 2 | 2 | 1 | 0 | 0 |
| `TDK_POS` | 2 | 0 | 1 | 0 | 0 | 0 |

There is one table group with multiple ACTIVE unbound QR sessions in each DB (three sessions in the test group, two in the production group). These counts are not proof of cross-device identities or an observed data leak. They do confirm that multiple per-browser tokens for one table are present. The production database currently has no open DINE_IN table session, so the reported live flow could not be reproduced from current production rows.

## QR session closure and reset paths

- Checkout completion and the explicit table-session close/cancel paths close related ACTIVE `qr_sessions` and revoke invites.
- Staff QR token cancellation checks for PENDING orders and refuses cancellation until they are resolved; then it closes active QR sessions and revokes invites.
- QR assignment/replacement closes unbound sessions for the target table but does not first block when those sessions own PENDING orders. Since the POS pending list filters for ACTIVE QR sessions, this path can make a pending order disappear from that list. This is an order-processing consistency risk, not evidence of old-history disclosure.
- QR-session expiration is enforced at authorization time; the reviewed paths do not transition expired rows to `EXPIRED`. Old ACTIVE rows therefore remain available to the staff queue unless separately closed.

## Database comparison

Compared QR-related `information_schema` metadata for 10 tables: 100 columns and 67 index entries match exactly. All 27 foreign-key relationships match semantically; one `qr_sessions.table_id` foreign-key **constraint name** differs (`fk_qr_sessions_table_id` in test, `fk_qr_sessions_dining_table` in production).

Both DBs have:

- `qr_sessions.table_id BIGINT UNSIGNED NULL`, indexed by `(table_id, status)`, referencing `dining_tables.table_id`.
- Unique index on `qr_sessions.token_hash`; indexes on `(session_id,status)` and `(table_id,status)`.
- `qr_table_links` with a unique `table_id` mapping.
- `qr_session_invites` with unique token hash and session/expiry/redeemed metadata.
- `qr_orders.qr_session_id` foreign-keyed to a QR session.

No DB migration or row write was performed.

## Security observations and remaining verification

- Source logs reviewed for these entry/join paths do not log raw customer or invite token values. Invite tokens are carried in the URL path, so actual NAS/Caddy access-log redaction and retention were not verified; the checked-in Caddy examples do not establish the active NAS logging configuration.
- `qr_sessions` and `table_sessions` do not have a database-level unique constraint for one ACTIVE QR token or one OPEN dine-in session per table. Application paths lock the QR/table row before issuing/creating sessions; current metadata counts show no duplicate OPEN dine-in session groups. This relies on all writers respecting the lock protocol.
- No isolated two-device DB integration scenario was run because it would require creating test order/session rows. Production was not used for scenario testing.
- Existing tests passed: 17 tests across QR processing policy, expiry, access-state, invite failure mapping, and API route manifest. They validate the helpers and route registration, not the complete transaction-level two-phone flow.

## Next-stage direction (requires policy approval before auth changes)

1. Decide whether two independent unbound customer tokens may share the first session only when both have pending orders, or whether every additional device must use an invite.
2. Add transaction-level test fixtures in `TDK_POS_TEST` (with guaranteed cleanup/rollback) for simultaneous first scans, first acceptance, invite reuse/capacity, close/reset, and an old browser token.
3. Gate POS acceptance of expired unbound sessions without silently hiding PENDING orders; surface stale orders to staff for explicit resolution.
4. Make QR assignment/replacement preserve visibility or explicitly block when an unbound session has a pending order.
5. Verify the currently deployed production revision and NAS access-log handling before attributing the customer report to this local source snapshot.
