# Mandatory TV authentication for the first QR order

The customer order page, authentication status and issue endpoints, verification endpoint, and order submission use the same readiness decision. The app checks the configured and connected database, all columns from the three TV authorization tables in the Drizzle schema, and the TV state row. Production ignores the former `TDK_QR_ORDER_AUTH_ENABLED` flag. Development enables authentication by default on `TDK_POS_TEST`. Set `TDK_QR_ORDER_AUTH_TEST_OFF=true` on that verified development database to run the legacy submission regression. When readiness fails, the customer sees the existing staff-contact message and the submission API returns `503 QR_AUTH_UNAVAILABLE` before creating an order.

The existing verification and representative transaction still requires proof for the first QR order. HOS or POS staff can decide pending requests. The confirmed representative can submit follow-ups using the existing claim. When a visit ends, claim cleanup still runs during a TV outage. Older schemas can complete visits when the authorization tables or relevant columns are absent. Other cleanup errors still roll back the visit close transaction.

## Development verification

- The default `TDK_POS_TEST` HTTP flow passed first-order proof, concurrent submission, HOS approval and rejection, representative follow-ups, history and round totals, POS staff orders, payment, and both COMPLETE paths. Isolated fixture cleanup passed.
- The explicit TEST-only OFF flow passed legacy submission, HOS approval, and history isolation at COMPLETE. The scan and invite preflight checks passed in both modes. Cancellation-scope regression passed.
- An isolated app copy simulated a missing TV state row against `TDK_POS_TEST` by changing its readiness query. The order page returned HTTP 200 with the unavailable state. Authentication status, issue and verify requests and order submission returned HTTP 503. No order had the attempted request ID. The simulation required no schema changes.
- QR and related unit tests passed with the repository TypeScript alias loader. API-access tests, TypeScript, scoped ESLint, `git diff --check`, and the production build passed. The build reported two existing Turbopack tracing warnings in `menu-image-storage.ts`.

## Release handoff

- The release scope is the QR readiness policy and customer routes, visit cleanup compatibility, environment examples, and TEST preflight scripts. The code uses the existing TV-7 tables and state row. It introduces no migration.
- Before an approved release, confirm the connected production database, all three authorization table definitions, the singleton TV state row, the deployed NAS image and source revision, and any remaining legacy pending requests. The earlier read-only check covered the previous 16-column subset. Review outstanding requests through the existing staff flow with the operator's decision.
- After an approved release, verify first-order TV authentication from a customer device through DP1 and HOS, followed by a representative follow-up and visit completion on an authorized test table. The NAS image and physical DP1 and Samsung Internet behavior remain unverified.
