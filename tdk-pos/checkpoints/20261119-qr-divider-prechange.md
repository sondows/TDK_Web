# QR divider pre-change checkpoint

- Captured: 2026-11-19 Asia/Seoul
- Source: `src/app/qr/QrMenuClient.tsx`
- Function: `QrDoubleDivider`, currently lines 41-46 before this change
- Worktree state before this task: source file already had unrelated uncommitted QR UI changes (`git status --short` reported it as modified); many other files in the repository were also modified. Preserve all of them.
- Restore scope: only restore the second child span in `QrDoubleDivider` if requested. Do not restore the full source file from Git.

Original component:

```tsx
function QrDoubleDivider({ fullBleed = false }: { fullBleed?: boolean }) {
  return <div aria-hidden="true" className={`relative h-4 bg-slate-50 ${fullBleed ? "left-1/2 z-[2] w-screen -translate-x-1/2" : "w-full"}`}>
    <span className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-px bg-[#D0D8E2]" style={{ boxShadow: "0 3px 3px rgba(0, 0, 0, 0.2)" }} />
    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#E5EAF0]" />
  </div>;
}
```

Only intended source change: remove the second `<span>` above. Keep the wrapper and first `<span>` unchanged.
