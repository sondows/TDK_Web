"use client";

import type { ReactNode } from "react";
import { useHorizontalScroll } from "@/hooks/useHorizontalScroll";

export default function PosFooterBar({ children }: { children: ReactNode }) {
  const { ref, hints, handlers } = useHorizontalScroll();

  return <section className="pos-footer-bar relative col-span-2 min-w-0 rounded-2xl bg-white p-3 shadow-sm">
    <div
      aria-label="POS 기능"
      className="horizontal-select-scroll pos-footer-scroll flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [touch-action:pan-x]"
      ref={ref}
      role="group"
      {...handlers}
    >
      {children}
    </div>
    {hints.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-3 left-0 flex w-3 items-center justify-center bg-white/90 text-lg leading-none text-slate-600">⋮</span>}
    {hints.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-3 right-0 flex w-3 items-center justify-center bg-white/90 text-lg leading-none text-slate-600">⋮</span>}
  </section>;
}
