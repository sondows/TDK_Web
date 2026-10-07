"use client";

import { useState } from "react";
import PosSubHeader from "./PosSubHeader";

type PersonCountModalProps = {
  sessionId?: number;
  title?: string;
  personCount: number;
  babyCount: number;
  busy: boolean;
  error: string;
  close: () => void;
  save: (personCount: number, babyCount: number) => void;
};

const clamp = (value: number) => Math.max(0, Math.min(99, value));

export default function PersonCountModal({ sessionId, title = "인원 조정", personCount, babyCount, busy, error, close, save }: PersonCountModalProps) {
  const [adult, setAdult] = useState(personCount);
  const [child, setChild] = useState(babyCount);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const step = (setter: (value: number) => void, value: number, delta: number) => setter(clamp(value + delta));

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => !busy && close()}>
    <section aria-labelledby="person-count-title" className="w-full max-w-[34rem] overflow-hidden rounded-2xl bg-white shadow-xl" onClick={event => event.stopPropagation()} role="dialog">
      <PosSubHeader backIconSize={19} backVisualSize={39} className="!min-h-[63px] !py-1.5" disabled={busy} onBack={close} title={title} titleId="person-count-title" trailing={<button aria-expanded={adjustmentOpen} className="mr-1 whitespace-nowrap border-0 bg-transparent p-0 text-xs font-medium text-white/70 shadow-none transition-colors hover:text-white" disabled={busy} onClick={() => setAdjustmentOpen(open => !open)} type="button">직접조정 ⋮</button>} />
      <div className="px-6 pb-5 pt-4">
      <div className="mt-4 space-y-3">
        <section><div className="grid grid-cols-4 justify-items-center gap-0">{[1, 2, 3, 4].map(value => <button className={`min-h-[84px] w-[80%] rounded-xl border-2 text-base font-bold ${adult === value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`} disabled={busy} key={value} onClick={() => setAdult(current => current === value ? 0 : value)} type="button">성인 {value}</button>)}</div></section>
        <section><div className="grid grid-cols-4 justify-items-center gap-0">{[1, 2, 3, 4].map(value => <button className={`min-h-[84px] w-[80%] rounded-xl border-2 text-base font-bold ${child === value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`} disabled={busy} key={value} onClick={() => setChild(current => current === value ? 0 : value)} type="button">아동 {value}</button>)}</div></section>
      </div>
      {adjustmentOpen && <>
      <div className="my-5 border-t border-slate-200" />
      <div className="space-y-3">
        {([["성인", adult, setAdult], ["아동", child, setChild]] as const).map(([label, value, setter]) => <div className="mx-auto flex w-[95%] items-center justify-center gap-12 rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-md" key={label}><strong className="text-lg">{label}</strong><div className="flex items-center justify-center gap-4"><button aria-label={`${label} 감소`} className="flex size-11 items-center justify-center rounded-xl border-2 border-slate-300 bg-white text-3xl font-bold text-slate-700 disabled:opacity-40" disabled={busy || value <= 0} onClick={() => step(setter, value, -1)} type="button">−</button><b className="min-w-24 text-center text-2xl tabular-nums">{value}명</b><button aria-label={`${label} 증가`} className="flex size-11 items-center justify-center rounded-xl border-2 border-slate-300 bg-white text-3xl font-bold text-slate-700 disabled:opacity-40" disabled={busy || value >= 99} onClick={() => step(setter, value, 1)} type="button">+</button></div></div>)}
      </div>
      </>}
      {error && <p className="mt-4 text-center text-sm font-semibold text-red-600">{error}</p>}
      <button className="mx-auto mt-3 flex min-h-[64px] w-[65%] items-center justify-center rounded-xl bg-blue-600 text-xl font-bold text-white transition hover:bg-blue-700 disabled:opacity-50" disabled={busy} onClick={() => save(adult, child)} type="button">{busy ? "저장 중..." : "확인"}</button>
      {sessionId !== undefined && <span className="sr-only">세션 {sessionId}</span>}
      </div>
    </section>
  </div>;
}
