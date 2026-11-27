# QR entry release-preflight regression (2026-11-27)

## Finding

`deploy/prepare-release.ps1` invokes `scripts/verify-qr-entry-development.cjs` as the `TEST QR entry` check. The user's failure output showed two `/qrorder/order` redirects where the script expected `/qrorder` plus `/qrorder/join-required`. The present `/tdkqrs/[identifier]` route deliberately issues separate, unbound QR sessions and sends both new customers to the menu. It does not bind the open POS table visit. `GET /api/qr/table-orders` returns no POS history until an order approval or explicit invite grants access. TV-7's first verified order submission, rather than a QR scan, atomically creates the representative claim. The old test expectation was stale; no application route or database schema changed.

The next release check, `TEST QR invite join`, also expected an uninvited pending order to be staff-blocked. The current staff approval policy permits a valid pending order to be reviewed without an invite. Its customer still cannot view POS history before approval. The invite test now checks both conditions and keeps expiry and invite guards.

## Changes

- `scripts/verify-qr-entry-development.cjs`: checks two distinct cookies and active unbound sessions, menu access, no POS visit binding, no representative claim, no shared history, and stable rescan token. Removes old automatic POS-first ownership and replacement expectations.
- `scripts/verify-qr-invite-development.cjs`: checks approval eligibility without an invite and continued isolation of pending customer's order history.
- `PLANS.md`: records this completed preflight investigation.

## Verification

- The first isolated attempt was blocked by sandbox `EACCES` to `192.168.0.83:3306`; the authorized rerun reached TEST DB. A new development server could not start because an existing one held the Next dev lock. The script then used the existing `127.0.0.1:3000` server and confirmed its database identity as `TDK_POS_TEST` before writing synthetic fixtures.
- `TEST QR entry`: PASS three times, each with unique TEST fixtures and cleanup.
- `TEST QR invite join`: PASS with the revised approval and privacy assertions.
- `TEST cancellation scope`: PASS.
- QR policy unit tests: 21/21 PASS; API-access tests: 30/30 PASS.
- TypeScript `--noEmit`: PASS; focused ESLint: PASS; `git diff --check` on changed scripts: PASS.
- Next.js 16.3.5 production build: PASS; two existing dynamic filesystem-tracing warnings from `menu-image-storage.ts` remain.

TV-7C/D flag-ON HTTP integration was previously recorded as passing in its stage checkpoints, but was not rerun in this turn. The occupied local server used the default-OFF mode. No Git staging, commit, push, NAS deployment, production DB operation, or Docker/Caddy restart occurred. The full release automation was not run because it stages and commits/pushes files. This resolves the demonstrated `TEST QR entry` assertion and the immediately following invite assertion; a complete deployment readiness decision still requires the separate NAS and production preflight conditions.
