# Ingress 403 diagnostic checkpoint — 2026-11-01

## Change scope

- `server.cjs`: capture incoming Host and origin-secret metadata before ingress strips the header; emit one JSON diagnostic line only when the ingress result is `untrusted`.
- `kds-ingress.cjs`: export the existing `validSecret()` helper for the diagnostic comparison. The validation function and ingress decision are unchanged.
- `src/lib/kds-ingress.test.mjs`: assert rejected-request logging, accepted-request silence, exact 403/200 behavior, and absence of the raw secret from output.
- `PLANS.md`: record investigation and verification status.

Diagnostic output includes only Host, configured publicHost, match booleans, header presence and lengths, ingress result, socket remote address, and NODE_ENV. It excludes the secret value, authentication header value, employee ID, PIN, and token.

## Verification

- Node syntax checks: passed.
- TypeScript `npx tsc --noEmit`: passed.
- ESLint on all changed code files: passed.
- `node --experimental-strip-types --test src/lib/kds-ingress.test.mjs`: 10/10 passed.
- `git diff --check`: passed.

The NAS request responsible for the reported 403 has not been observed with this instrumentation. Its specific failing condition remains unverified. No production deployment or DB access occurred.

## Restore

Remove the diagnostic snapshot and warning block from `server.cjs`, remove the `validSecret` export from `kds-ingress.cjs`, and remove the diagnostic assertions added to `src/lib/kds-ingress.test.mjs`. Preserve all unrelated work and the earlier checkpoints.
