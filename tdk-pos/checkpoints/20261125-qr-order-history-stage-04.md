# TDKON QR order history, stage 4 — 2026-11-25

Status: PASS for the development implementation and automated checks. Production and physical mobile behavior remain unverified.

## Scope and response contract

- `GET /api/qr/table-orders` now returns `orders` and `items` only for confirmed QR requests whose `accepted_order_id` belongs to a POS order in the caller's authorized open table session. `posOrders`, `posItems`, and `confirmedSummary` are likewise available only with whole-session access.
- New `ownRequests` and `ownRequestItems` fields contain only QR requests belonging to the authenticated `qr_session_id`, including PENDING, REJECTED, and ACCEPTED. An unapproved caller receives no `orders`, POS rows, or `confirmedSummary`.
- The customer history page displays own unconfirmed requests separately and never duplicates an accepted own request as a request card. The order screen's history navigation now checks own requests and POS orders.
- Current whole-session access proof remains `ORDER_APPROVED`, `INVITED`, or valid `LEGACY`; this stage did not change token or invite policy.

## Confirmed order and KDS presentation

- One `orders` row equals one confirmed round. QR metadata annotates its `accepted_order_id`; the approved QR request is not counted as another round. Rounds sort by `orders.ordered_at`, then `orders.order_id`, and are rendered newest first with their stable 1-based round number.
- POS and QR approved orders use the same POS order-item summary function. `effectiveTotalAmount` per round is calculated with the same grouping and cancellation rules as the top gross amount; discounts and prepayments remain separate session-level figures.
- The customer KDS line uses persisted `kds_tasks` state and server timer start/minutes. It shows waiting, cooking, kitchen completion, store boiling, and final completion. All visible KDS menus have progress; a menu without `kds_post_cook_timer` skips boiling. TEST menu settings show stews as POT with timer and egg roll as SOLO without timer.
- A KDS task is keyed by `order_item_id`, and a POS order item can hold quantity greater than one. Existing KDS data has no independent state per unit within that line. Separate order-item lines can have separate stages; partial completion of one multi-quantity line cannot be represented faithfully without changing KDS semantics.
- The existing five-second poll, focus/visibility refresh, server-clock offset, title/hero, and fixed three-button history navigation remain. Long menu/option labels can wrap instead of being truncated.

## Verification performed

- TEST DB isolated HTTP integration: concurrent independent customer submissions, POS/HOS approvals, invited customer, own pending/rejected requests, exclusion of other customers' pending/rejected requests and items, no unapproved summary, confirmed totals, QR replacement access, duplicate approval, and close race: PASS. The harness verifies fixture cleanup.
- TEST DB QR preparation/activation SQL regression and lock race: PASS. Its optional customer QR HTTP checks were skipped because `QR_TEST_HTTP_BASE_URL` was not set for that run.
- QR/manifest/summary/progress/round unit tests: 28 passed. KDS model/grouping unit tests: 103 passed.
- TypeScript `tsc --noEmit`: PASS. Scoped ESLint: PASS. `git diff --check`: PASS. Next production build: PASS, with two existing dynamic filesystem tracing warnings in `menu-image-storage.ts`.
- TEST DB menu-policy read: stew menus POT/timer=1; egg roll SOLO/timer=0. No production DB read or write was performed.

## Not verified

- Physical Samsung Internet or Android Chrome layout and browser toolbar behavior; no real smartphone was available.
- Actual KDS hardware transitions, multi-device timer display, actual POS payment reconciliation, and full authorized ADM/HOS device workflows. Unit/API tests cover the underlying code paths but do not prove these environments.
- A quantity-2 order item with one unit individually completed cannot be displayed because KDS persists one task status for the entire order item.

No schema change, production DB/NAS deployment, Docker/Caddy restart, commit, or push was performed. Existing worktree changes were preserved. Stage 5 was not started.
