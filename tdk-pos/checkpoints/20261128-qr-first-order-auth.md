# QR first-order authentication — 2026-11-28

## Operating incident

The live `/qrorder/order` response returned HTTP 200 with `Cache-Control: private, no-cache, no-store` and serialized `qrAuthFlowEnabled=false`. The live `GET /api/qr/order-auth` returned 404 JSON. Both `/tdktv/dp1` and its code-state API returned 200. At the code level, the disabled branch of `submitTableOrder` posts straight to `/api/qr/table-orders`. The TV issuance function is called from the authentication-start POST, so a skipped start means there is no new number for either DP1 or HOS to display. A fresh server response reproduces the disabled state without depending on a browser cache.

Only the exact runtime value `TDK_QR_ORDER_AUTH_ENABLED=true` can enable the feature. Production additionally requires `NODE_ENV=production`, configured and connected database `TDK_POS`, and a successful TV-7 schema probe. Development uses the corresponding `development` and `TDK_POS_TEST` pair. The feature flag is a server setting passed to the client by the dynamic order page. Compose reads `.env.production` for the container. The local `.env.local` does not set the flag. Historical QR-5 rollout evidence showed OFF, and the current live result is still disabled. The underlying current NAS reason remains open until the actual flag, image ID and running revision are read. Noninteractive SSH authentication was rejected. Local baseline before these edits was `eb0584ad516a3088763fc696a79d5718b2e666ee`.

## Implemented paths

- `QrMenuClient` refreshes the current representative before sending. With no representative it opens the customer modal, posts the existing cart to the issuance endpoint, verifies two keypad digits, and submits the original request and verified attempt to the existing transaction. A confirmed representative skips the modal. The server is still authoritative on the claim and session.
- The existing order transaction writes the pending order, claims the representative for that table and visit, and consumes the proof as one unit. HOS approval, first-order rejection, PAY/COMPLETE, and the DP1/HOS state source stay on their existing paths.
- `QR → 인증버튼` uses the existing ADM menu permission. It stores title, guidance, and a photo reference in three existing `system_settings` rows. New images are converted to bounded WebP using the same encoder as QR notices and live in the `order-auth-guide` subdirectory of the already mounted QR notice volume. The shared preview does not issue a code. Customer rendering falls back to the default guide if settings or the image are missing.

## Verification evidence

- Local TypeScript, scoped ESLint, `git diff --check`, 31 API access tests and 25 related tests passed.
- `TDK_POS_TEST` HTTP flag ON: the TV-7D integration suite passed, including first-order enforcement, concurrent representative claim, HOS approval/rejection and DP1/HOS state agreement, PAY and both COMPLETE paths. Fixture cleanup passed.
- `TDK_POS_TEST` HTTP flag OFF: legacy order submission, two customer scans, order visibility, HOS approval and COMPLETE isolation passed. Fixture cleanup passed.
- ADM HTTP: a valid staff session saved and reloaded text and uploaded, replaced and deleted a photo. Invalid images and customer writes were rejected. The resized image preserved its aspect ratio.
- Chrome (320 × 530, actual components in a fixture, with the live TEST DB HTTP handlers): ADM preview, customer photo, visible leading zero, backspace and clear, one automatic verification per two digits, wrong entry, expiry, closing with the cart retained, one automatic submission and the PENDING representative claim passed. DP1 displayed the same issued number in white with a black stroke, a transparent wrapper and no idle placeholder, then hid it on expiry. The fixture supplied Next.js navigation and image adapters after full page requests in the isolated dev servers timed out. Native Samsung Internet and TV Bro still need physical verification.
- The QR cancellation scope check passed. QR entry and invite regression passed on the existing local development server after the isolated server timed out on full page requests. Production build passed with two existing menu-image-storage tracing warnings.

## NAS verification before release

Confirm the NAS checkout, running image ID and environment separately. With separate release approval, deploy the tested code, verify the existing auth schema and TV notice state, set the service environment to `TDK_QR_ORDER_AUTH_ENABLED=true`, and recreate the service to load the new environment. The guide uses the existing QR notice volume and settings schema. After rollout, the order page must serialize the enabled state and the auth status route must require a customer session. Verify DP1 on TCL TV Bro and the keypad on Samsung Internet as part of that rollout.
