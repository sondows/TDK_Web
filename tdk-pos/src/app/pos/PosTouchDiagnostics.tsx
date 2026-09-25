"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Trace = {
  id: number;
  type: string;
  target: string;
  pointerType: string;
  defaultPrevented: boolean;
};

const eventTypes = ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "click"] as const;

function describeTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return String(target);
  const label = target.getAttribute("aria-label") || target.textContent?.trim().replace(/\s+/g, " ").slice(0, 18);
  return `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ""}${label ? ` · ${label}` : ""}`;
}

export default function PosTouchDiagnostics() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const enabled = pathname === "/pos" && searchParams.get("touchDebug") === "1";
  const [traces, setTraces] = useState<Trace[]>([]);
  const nextId = useRef(0);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!enabled) return;

    const capture = (event: Event) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      const id = ++nextId.current;
      const trace: Trace = {
        id,
        type: event.type,
        target: describeTarget(event.target),
        pointerType: event instanceof PointerEvent ? event.pointerType : event instanceof TouchEvent ? "touch" : "-",
        defaultPrevented: event.defaultPrevented,
      };
      window.setTimeout(() => {
        setTraces(previous => [...previous, { ...trace, defaultPrevented: event.defaultPrevented }].slice(-15));
      }, 0);
    };

    for (const type of eventTypes) window.addEventListener(type, capture, { capture: true, passive: true });
    return () => {
      for (const type of eventTypes) window.removeEventListener(type, capture, { capture: true });
    };
  }, [enabled]);

  if (!enabled) return null;

  return <section aria-label="터치 진단창" className="pointer-events-none fixed bottom-3 right-3 z-[200] w-[360px] max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-400 bg-white/95 p-2 text-slate-900 shadow-xl" ref={panelRef}>
    <header className="mb-1 flex items-center justify-between gap-2 text-xs font-bold">
      <span>터치 진단창 · 최근 15개</span>
      <button className="pointer-events-auto rounded border border-slate-300 bg-white px-2 py-1 text-xs" onClick={() => setTraces([])} type="button">지우기</button>
    </header>
    <div aria-live="off" className="max-h-[45vh] space-y-0.5 overflow-hidden font-mono text-[11px] leading-4">
      {traces.length === 0 ? <p className="text-slate-500">화면을 터치하면 이벤트가 표시됩니다.</p> : traces.map(trace => <div className="truncate" key={trace.id} title={trace.target}>
        <span className="mr-1 text-slate-400">{trace.id}</span>
        <strong>{trace.type}</strong>
        <span className="ml-1">{trace.pointerType} · prevented:{String(trace.defaultPrevented)}</span>
        <span className="ml-1 text-slate-600">{trace.target}</span>
      </div>)}
    </div>
  </section>;
}
