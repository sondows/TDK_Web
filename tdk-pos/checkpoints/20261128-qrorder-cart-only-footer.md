# TDKQRS order-screen footer separation — 2026-11-28

| Check | Result |
|---|---|
| Trace footer render paths | PASS |
| Keep three-button navigation on order history only | PASS |
| Anchor order-screen cart above the safe area with no menu reservation | PASS |
| QR footer regression tests, TypeScript, ESLint and production build | PASS |
| Verify Samsung Internet and a physical phone | TODO |

`QrOrderHistory` remains the only screen rendering `QrBottomNavigation`. The table-order menu previously rendered it directly from `QrMenuClient` when `tableOrderMode` was enabled, which caused the menu row to appear below the blue cart. Removed that render path. The cart sheet now anchors at the bottom safe-area inset; the menu document and quick-add toast reserve only cart and safe-area space. Cart contents, expand/collapse behavior, submission UI and fan controls on order history are unchanged.

The targeted navigation/cart source regression tests (2), related QR unit tests (22), TypeScript, focused ESLint, `git diff --check`, and production build passed. Production build retained two existing dynamic filesystem tracing warnings in `menu-image-storage.ts`. No browser/device session, operating DB, NAS, Docker/Caddy, or Git history was changed.
