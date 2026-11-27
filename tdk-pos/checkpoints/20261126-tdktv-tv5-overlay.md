# TDKTV TV-5 event overlay rendering fix

Date: 2026-11-26

## Cause

Both the TV player and ADM preview placed the event background, border and padding on the absolute positioning wrapper. That wrapper used `widthPercent` as a fixed width, so even short messages painted a wide rectangle; `overflow: hidden` also clipped content at the wrapper boundary. The player contains no separate placeholder/drag handle element: it renders the saved `message` directly in a span. The source does not establish the exact device-side cause of the reported white square glyphs. The app bundles Geist subsets without Korean glyph coverage and the body fallback starts with Arial, so missing CJK glyph coverage on the display is a plausible cause.

## Changes

- Added shared event wrapper/text style calculation in `src/lib/tdktv-event-rendering.ts`.
- Kept the outer anchor unpainted, `fit-content`, and capped its width by the configured percentage.
- Moved background, border and small padding to the text-sized child; enabled line wrapping and added a subtle text shadow.
- Added explicit Noto Sans CJK KR / Malgun Gothic / Apple SD Gothic Neo / sans-serif fallback order.
- Reused the same style helper in the ADM editor preview and TV player.
- New event drafts now default to a transparent background. Saved event settings remain intact.
- Added rendering style tests.

## Verification

- Rendering policy tests: 4/4 pass.
- TypeScript: pass.
- Targeted ESLint: pass.
- Production build: pass. Next.js emitted two dynamic filesystem tracing warnings from the existing `src/lib/menu-image-storage.ts`; they are outside this change.
- No browser session or physical TV was available, so actual glyph rendering and visual spacing are unverified.
- No DB, NAS, Docker/Caddy, commit, or push changes.
