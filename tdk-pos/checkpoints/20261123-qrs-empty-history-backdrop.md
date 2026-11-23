# TDKQRS short order-history backdrop — 2026-11-23

## Cause

The order-history panel's existing `bg-slate-50` backdrop is absolutely positioned from the title area to the panel's bottom. When the payment-complete or empty-history state makes the panel short, that backdrop ends with the panel. The fixed hero image remains in the lower stacking layer and can show through below the shortened content.

## Change

- Keep the existing `bg-slate-50` backdrop and image/content stacking.
- Measure the visual viewport and actual fixed navigation height through the existing panel geometry reader.
- Give the existing backdrop a minimum height that fills from its top edge to the navigation boundary, while its existing `bottom: 0` behavior still covers longer panels.
- No fixed overlay, new card, border, shadow, order-state logic, API, or session behavior was added or changed.

## Verification

- Panel geometry/wheel tests: 10 passed, including short-content backdrop minimum-height cases.
- TypeScript: passed.
- Scoped ESLint: passed.
- Production build: passed. Next.js emitted two existing dynamic filesystem tracing warnings in `src/lib/menu-image-storage.ts`.
- Actual Android/Samsung Internet and Chrome device rendering was not tested. No production deployment, DB change, commit, or push occurred.

## Files

- `src/app/qrorder/QrOrderHistory.tsx`
- `src/lib/qr-order-panel-geometry.ts`
- `src/lib/qr-order-panel-geometry.test.mjs`
