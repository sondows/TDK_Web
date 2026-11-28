# Production first QR order authentication investigation

## Confirmed observations

- A fresh production `GET /qrorder/order` returned 200 and passed `qrAuthFlowEnabled=false` and `qrAuthUnavailable=false` to the client. `GET /api/qr/order-auth` returned 404 JSON. `/tdktv/dp1` and `/api/tdktv/qr-auth-code` returned 200.
- `src/app/qrorder/order/page.tsx` derives both props from the runtime flag and readiness check. If an exact `true` enables the readiness check and that check fails, the page passes `false, true`. The publicly observed `false, false` matches the legacy branch. The exact container value may be unset, explicitly off, or a string the check does not accept.
- The final order button in `src/app/qr/QrMenuClient.tsx` calls `submitTableOrder`. The legacy branch posts the cart directly to `/api/qr/table-orders`. With the feature ready and no representative, the client opens the existing modal and calls `/api/qr/order-auth` to issue the TV code. After two digits, it calls `/api/qr/order-auth/verify` and sends the verified attempt with the order.
- The order POST uses the same readiness function. Exact `true` with failed readiness returns 503 before insertion. The legacy branch skips representative and TV proof checks and saves a `PENDING` QR order for staff approval. The enabled branch checks the current visit representative and requires a verified attempt for the first QR order, regardless of staff orders. Approval confirms the representative, confirmed representatives can place follow-up orders, and COMPLETE resets the claim. `PENDING` on a QR order is the staff approval status.
- A separate read-only connection to `TDK_POS` found all 16 required columns and the initialized TV auth state row. In the preceding 24 hours, five QR orders had no linked `CONSUMED` attempt. One was pending and four were rejected. The query used a separate connection from the app container.

## Rollout and deployment

TV-7B introduced opt-in authentication for development and staged deployment. The earliest retained commit with the flag is `ba5bc6b` on 2026-11-27. QR-5's first rollout and `.env.production.example` used OFF to preserve the legacy flow until operational verification. The flag is a server runtime setting. Compose reads the NAS `.env.production` when creating the app container. Neither the Docker build arguments nor the current forward deployment scripts set the flag. The example file does not configure an existing container. The QR order page is dynamic.

Local HEAD and GitHub main matched `fd6831ccd56ffb892e3397f7cafb1add822013ad`. The second prop is present in the earlier keypad commit `bb3d88f`, and the public page exposes it. The exact deployed SHA and image remain unverified. NAS accepted an SSH connection on port 22 but rejected noninteractive authentication. Container creation time, runtime variables, logs, and Caddy upstream attribution remain pending NAS evidence.

## Verification

- `TDK_POS_TEST` HTTP with auth OFF accepted a QR order without TV proof, then passed HOS approval, shared current-visit history and COMPLETE isolation.
- `TDK_POS_TEST` HTTP with auth ON passed code issuance and verification, order creation, representative and approval checks, both completion paths, and concurrency scenarios.
- With the flag ON, a temporary isolated source copy simulated 15 of 16 schema columns. The page returned `false, true`, the order POST returned 503 with the existing configuration/readiness message, and no QR order was persisted. No DDL was needed. Temporary TEST rows were cleaned up.
- QR entry and order-history regression, 42 selected tests, TypeScript, scoped ESLint, `git diff --check`, and production build passed. The build reported two Turbopack file tracing warnings in `menu-image-storage.ts`.
- Current verification was HTTP and DB based. The earlier Chrome component verification is recorded in [the first-order authentication checkpoint](20261128-qr-first-order-auth.md). Actual customer Samsung Internet and DP1 device verification remain pending.

## Decision pending approval

Option A retains the rollout setting. For an approved configuration-only recovery, verify the NAS image and database, set the real NAS `.env.production` value to `true`, recreate the app service, and verify the runtime value and first-order guard. A build is necessary if an older image is still deployed. This option can regress if the setting is omitted again.

Option B makes first QR order proof mandatory in production and keeps an OFF path only for isolated development checks if needed. Share the mode and readiness decision between the page and order endpoints. When TV authentication or a required schema is unavailable, show the existing customer error and block QR submission where proof cannot be verified. Preserve the representative follow-up rule and the POS employee order flow. Before deploying, confirm production readiness and how outstanding legacy pending orders will be handled, then run an approved QR-to-DP1-to-HOS smoke test. Option B is recommended for steady-state operation.

This investigation changed only the planning and checkpoint documents. The operating database was queried read-only. No production flag, container, release, or application code was changed.
