# Table QR scan after visiting another table — 2026-11-28

## Evidence

- Read-only SQL on `TDK_POS` found QR 20261127-0001 (row 7) and 20261127-0002 (row 8) in `TABLE_ORDER / IN_USE`, linked to active tables numbered 1 and 2. Both internal identifiers match the 16-character scanner format. Both tables had zero open visits at query time.
- QR 0002 logged `QR_ACCESS_FAILED / SESSION_TABLE_MISMATCH` at database time 21:19:46. QR 0001 had recent reuse entries at 21:18:24 and 21:18:37. The audit records cannot tie those entries to the same browser. The failure reason proves the 0002 scan resolved the QR record and its table link, then hit the branch rejecting an active session from a different table.
- ADM labels the stored `IN_USE` status as “사용 중.” Its image endpoint reads `qr_codes.identifier` by row ID and produces a canonical `https://tdkon.myasustor.com/tdkqrs/<identifier>` SVG. The management number on the card and in the PNG filename is `qr_codes.management_number`. The deployed protected image and physical sticker were not independently decoded.
- Local baseline was `bb3d88f000d2b4c64b2b72377f858a805b365f3b`. NAS SSH connected but rejected noninteractive authentication. The exact checkout, running image and revision are unverified. The production audit establishes the running branch behavior.

## Repair and verification

`src/app/tdkqrs/[identifier]/route.ts` now reuses only a cookie for the scanned table and sends a mismatched cookie through fresh session issuance. The transaction still verifies the scanned QR state, table activity and link, and creates a new unbound session scoped to the destination table. This replaces the browser's current QR cookie. It does not transfer the prior table’s session, orders or representative claim. Same-table reuse is unchanged.

`scripts/verify-qr-entry-development.cjs` reproduced the original rejection with two synthetic tables before the change. After the change, HTTP tests on `TDK_POS_TEST` passed for a fresh browser, switching to an empty table, switching to a populated table with a confirmed representative, independent tokens and order history, same-table reuse, visit closure and rescan, and rejection of locked, retired, inactive and unassigned targets. The existing invite regression passed. Fixture cleanup, TypeScript, scoped ESLint, `git diff --check`, 51 unit and API tests, and the production build passed. The build retained two existing menu-image storage tracing warnings.

QR 0001 and 0002 do not require a production data edit or a reprint for this cause. Deploy the route fix separately and check the existing 0002 sticker first with an active cookie from another table, then from a fresh browser. No production scan that would create a session was sent during this investigation.
