# Existing and newly issued table QR scan investigation — 2026-11-28

## Operating evidence

| Management number | Current record | Recorded outcome |
|---|---|---|
| 20261127-0001 | `TABLE_ORDER / IN_USE`, active table 1 | Prior session reuse and issuance |
| 20261127-0002 | `UNASSIGNED / RETIRED`, link removed | `SESSION_TABLE_MISMATCH` while active, a successful issuance at 21:31:41, then retirement at 21:37:09 |
| 20261128-0001 | `TABLE_ORDER / IN_USE`, active table 2 | Assigned at 21:37:24, `SESSION_TABLE_MISMATCH` at 21:37:32 and 21:37:53 |

Times come from the operating DB audit. Both incident scans matched the stored QR and its active table link, then were denied by the old different-table cookie check before any new session was issued. A normal tab closure leaves the browser cookie in place. The later retirement of the older sticker is now an independent and intended denial. Production SELECT found no invalid active table links, no `UNUSED` table-order QR rows, and neither an open visit nor a representative claim on tables 1 and 2 at query time. Internal identifiers are 16 characters and `qr_codes.identifier` uses `ascii_bin`; consulted QR session columns were present. There is no DB or collation error indicated for these scans.

Local HEAD and remote `main` matched at `bb3d88f000d2b4c64b2b72377f858a805b365f3b`. The existing local route correction is uncommitted. NAS SSH rejected noninteractive authentication, so an exact image ID and revision were unavailable. The audit confirms that the operating runtime had the rejection at the time of both incidents. The public malformed-ID route returned a canonical HTTPS 302 to `/qrorder/unavailable`; valid production URLs were not fetched to avoid creating sessions or audit events.

## Route and status comparison

ADM allocates a numeric management number and a separate random identifier, inserts an unassigned, unused record, and assigns the active table in a separate transaction. Assignment sets `TABLE_ORDER / IN_USE` and writes `qr_table_links`. ADM renders a managed code image with `publicQrUrl(qr_codes.identifier)`, and the customer route uses that same identifier and table link. Legacy `/q/<identifier>` redirects to `/tdkqrs/<identifier>`. The original protected production image or the printed sticker was not decoded; the local authenticated HTTP test compared the actual served SVG against the exact HTTPS URL from the case-sensitive DB record.

The QR status and link checks remain in the entry transaction. The local correction reuses a session only for the scanned table and issues a fresh unbound session for a valid different table. The prior session does not grant authority at the new table. An unavailable QR leads to `/qrorder/unavailable`, while thrown DB/session errors use `/qrorder/service-unavailable`.

## Verification

- `tests/qr-issue-entry-http.integration.mjs`: authenticated development ADM issuance and assignment, exact SVG payload, active listing, legacy alias, fresh/cross-table and concurrent customer sessions, explicit retirement and invalid IDs. Only synthetic TEST data was created and removed; development issuance serials remain consumed.
- Existing development entry and invite regressions: POS-first and approved QR history, confirmed representative isolation, concurrent scans, previous-visit isolation, same-table reuse and locked, retired, inactive or unlinked QR protection.
- TV-7D auth ON and auth OFF HTTP/DB suites: two-digit verification, representative race, HOS approval, PAY and both COMPLETE paths, isolated test cleanup. Customer modal and physical devices were not rerun for this route-only change.
- TypeScript, scoped ESLint, `git diff --check`, 51 policy/API tests, and production build passed. The build retained the two existing menu image tracing warnings.

Use existing 20261128-0001 for table 2 after a separately authorized deployment of the local route fix. 20261127-0002 remains retired. The confirmed failure requires no QR data edit or reissue. Check scanning the existing active sticker in a browser with a previous table session after release.
