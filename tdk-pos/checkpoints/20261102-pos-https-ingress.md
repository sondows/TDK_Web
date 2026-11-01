# POS HTTPS ingress checkpoint — 2026-11-02

## Change scope

- `src/proxy.ts`: external POS requests now require the sanitized `x-tdk-verified-https` ingress marker instead of a LAN/VPN client-IP result. POS APIs and aliases remain inaccessible without verified Caddy HTTPS ingress.
- `src/lib/host-access.ts`: added the small verified-ingress marker reader and applied it to POS alias authorization.
- `src/lib/host-access.test.mjs`, `src/lib/kds-ingress.test.mjs`: cover the POS ingress policy, Caddy marker, and rejection/removal of a client-supplied marker.
- `PLANS.md`: records root cause, scope, validation, and deployment verification still required.

No authentication API, employee permission, password/PIN/token/session rule, HTTPS check, cookie attribute, Caddy configuration, environment variable, DB, Docker image, NAS, or production container was changed.

## Verification

- Related tests: 28/28 passed.
- Remaining existing test suite excluding the one loader-incompatible setup test: 233/233 passed.
- Full suite attempt: one unrelated test harness failure because `src/lib/initial-owner-setup.test.mjs` does not mock its `@/lib/initial-admin-setup` import.
- TypeScript: passed.
- ESLint on changed code/tests: passed.
- Production build: passed; two pre-existing dynamic-filesystem warnings remain.
- Actual NAS/Caddy, split DNS, Chrome POS login and QR/order flow: not verified.

## Restore

Restore the four source/test files from the prior Git state for this change, then remove this checkpoint and the matching `PLANS.md` section. Preserve the earlier ingress diagnostic work and all unrelated changes.
