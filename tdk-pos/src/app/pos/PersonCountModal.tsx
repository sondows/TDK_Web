"use client";

import { useState } from "react";

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
  const step = (setter: (value: number) => void, value: number, delta: number) => setter(clamp(value + delta));

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => !busy && close()}>
    <section aria-labelledby="person-count-title" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()} role="dialog">
      <header className="flex items-center gap-3">
        <button aria-label="인원 조정 닫기" className="flex size-11 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200" disabled={busy} onClick={close} type="button">
          <svg aria-hidden="true" fill="none" height="23" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="23"><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <h2 className="text-xl font-extrabold" id="person-count-title">{title}</h2>
      </header>
      <div className="mt-5 space-y-4">
        <section><h3 className="mb-2 text-sm font-bold text-slate-600">성인 빠른 선택</h3><div className="grid grid-cols-4 gap-2">{[1, 2, 3, 4].map(value => <button className={`min-h-16 rounded-xl border-2 text-lg font-bold ${adult === value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`} disabled={busy} key={value} onClick={() => setAdult(value)} type="button">성인 {value}</button>)}</div></section>
        <section><h3 className="mb-2 text-sm font-bold text-slate-600">아동 빠른 선택</h3><div className="grid grid-cols-4 gap-2">{[1, 2, 3, 4].map(value => <button className={`min-h-16 rounded-xl border-2 text-lg font-bold ${child === value ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"}`} disabled={busy} key={value} onClick={() => setChild(value)} type="button">아동 {value}</button>)}</div></section>
      </div>
      <div className="my-5 border-t border-slate-200" />
      <div className="space-y-3">
        {([["성인", adult, setAdult], ["아동", child, setChild]] as const).map(([label, value, setter]) => <div className="grid grid-cols-[5rem_minmax(0,1fr)_5rem] items-center gap-3" key={label}><strong className="text-lg">{label}</strong><div className="flex items-center justify-center gap-4"><button aria-label={`${label} 감소`} className="flex size-14 items-center justify-center rounded-xl border-2 border-slate-300 bg-white text-3xl font-bold text-slate-700 disabled:opacity-40" disabled={busy || value <= 0} onClick={() => step(setter, value, -1)} type="button">−</button><b className="min-w-24 text-center text-2xl tabular-nums">{value}명</b><button aria-label={`${label} 증가`} className="flex size-14 items-center justify-center rounded-xl border-2 border-blue-500 bg-blue-50 text-3xl font-bold text-blue-700 disabled:opacity-40" disabled={busy || value >= 99} onClick={() => step(setter, value, 1)} type="button">+</button></div><span /> </div>)}
      </div>
      {error && <p className="mt-4 text-center text-sm font-semibold text-red-600">{error}</p>}
      <button className="mt-6 min-h-[112px] w-full rounded-xl bg-blue-600 text-[22px] font-bold text-white transition hover:bg-blue-700 disabled:opacity-50" disabled={busy} onClick={() => save(adult, child)} type="button">{busy ? "저장 중..." : "확인"}</button>
      {sessionId !== undefined && <span className="sr-only">세션 {sessionId}</span>}
    </section>
  </div>;
}
