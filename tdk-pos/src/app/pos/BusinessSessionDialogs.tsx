"use client";

import { useEffect, useState } from "react";
import PosSubHeader from "./PosSubHeader";

const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const localTime = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
type Preview = {
  businessSessionId: number; businessDate: string; openedAt: string; previousClosingCount: number;
  openingCashEnabled: boolean; openingCash: number | null; expectedCash: number | null;
  blockers: Array<{ sessionId: number; label: string; reason: string }>;
  totalSales: number; saleCount: number; discountAmount: number; discountCount: number;
  cardAmount: number; cardCount: number; cashAmount: number; cashCount: number;
  otherAmount: number; otherCount: number; customerPaymentAmount: number; customerPaymentCount: number;
  bankTransferAmount: number; cancellationCount: number; refundAmount: number;
  dineCount: number; dineAmount: number; takeoutCount: number; takeoutAmount: number;
  cashReceived: number; cashReturned: number; cashLedgerMovement: number; otherCashChange: number;
};

export function BusinessOpeningDialog({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    const openingCash = Number(value);
    if (!Number.isSafeInteger(openingCash) || openingCash < 0 || !value.trim()) { setError("준비금을 입력해 주세요."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pos/business-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openingCash }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) { setError(result.message ?? "영업을 시작하지 못했습니다."); return; }
      onOpened();
    } catch { setError("영업을 시작하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/50 p-4">
    <section aria-modal="true" className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-2xl" role="dialog">
      <PosSubHeader backLabel="영업 준비금 입력 닫기" disabled={busy} onBack={onClose} title="영업 준비금" />
      <div className="p-6"><p className="text-slate-600">이번 영업세션의 시작 준비금을 입력해 주세요.</p>
        <label className="mt-5 block font-bold">시작 준비금
          <span className="mt-2 flex items-center gap-2"><input autoFocus className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-right text-xl" min="0" onChange={event => setValue(event.target.value)} type="number" value={value} />원</span>
        </label>
        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3"><button className="min-h-12 rounded-xl border border-slate-300" disabled={busy} onClick={onClose} type="button">취소</button><button className="min-h-12 rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void open()} type="button">영업시작</button></div>
      </div>
    </section>
  </div>;
}

export function BusinessClosingDialog({ onClose, onClosed }: { onClose: () => void; onClosed: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [actual, setActual] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setError("");
    try {
      const response = await fetch("/api/pos/business-session/close", { cache: "no-store" });
      const data = await response.json() as { success?: boolean; preview?: Preview | null; message?: string };
      if (!response.ok || !data.success) { setError(data.message ?? "마감 정보를 불러오지 못했습니다."); return; }
      setPreview(data.preview ?? null);
    } catch { setError("마감 정보를 불러오지 못했습니다."); }
    finally { setLoaded(true); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, []);
  async function close() {
    if (!preview) return;
    const actualCash = Number(actual);
    if (preview.openingCashEnabled && (!actual.trim() || !Number.isSafeInteger(actualCash) || actualCash < 0)) { setError("실제 현금을 입력해 주세요."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pos/business-session/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessSessionId: preview.businessSessionId, actualCash: preview.openingCashEnabled ? actualCash : null }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) { setError(result.message ?? "영업마감에 실패했습니다."); await refresh(); return; }
      onClosed();
    } catch { setError("영업마감에 실패했습니다."); }
    finally { setBusy(false); }
  }
  const line = (label: string, value: string) => <div className="flex items-center justify-between gap-3 py-1"><span>{label}</span><strong className="whitespace-nowrap text-right tabular-nums">{value}</strong></div>;
  const summaryLine = (label: string, value: number, count: number) =>
    <div className="flex items-center justify-between gap-3 py-1"><span className="whitespace-nowrap">{label}</span><strong className="grid grid-cols-[auto_3.5rem] items-baseline gap-1 whitespace-nowrap tabular-nums"><span className="text-right">{money(value)}</span><span className="text-right">({count}건)</span></strong></div>;
  return <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/50 p-4">
    <section aria-modal="true" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[26rem] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog">
      <PosSubHeader backLabel="영업마감 닫기" disabled={busy} onBack={onClose} title={preview?.blockers.length ? "영업마감 불가" : "영업마감"} />
      <div className="overflow-y-auto p-6 text-sm text-slate-700">
        {!loaded ? <p>마감 정보를 확인하는 중입니다.</p> : !preview ? <p>진행 중인 영업이 없습니다.</p> : <>
          <p className="font-bold">영업일 {preview.businessDate} · 영업시작 {localTime(preview.openedAt)}</p>
          {preview.previousClosingCount > 0 && <p className="mt-1 text-slate-500">이전 영업마감 {preview.previousClosingCount}건</p>}
          {preview.blockers.length ? <><p className="mt-4 font-bold text-red-700">완료되지 않은 주문이 있습니다.</p><ul className="mt-3 space-y-2">{preview.blockers.map((row, index) => <li className="rounded-lg bg-red-50 p-2" key={`${row.sessionId}-${index}`}>{row.label} · {row.reason}</li>)}</ul></> : <>
            <div className="mt-4">
              {summaryLine("총매출", preview.totalSales, preview.saleCount)}
              {summaryLine("할인", preview.discountAmount, preview.discountCount)}
              <hr className="my-3" />
              {summaryLine("카드", preview.cardAmount, preview.cardCount)}
              {summaryLine("현금", preview.cashAmount, preview.cashCount)}
              {summaryLine("기타결제", preview.otherAmount, preview.otherCount)}
              {summaryLine("고객결제", preview.customerPaymentAmount, preview.customerPaymentCount)}
              <hr className="my-3" />
              {summaryLine("취소/환불", preview.refundAmount, preview.cancellationCount)}
              {summaryLine("매장판매", preview.dineAmount, preview.dineCount)}
              {summaryLine("포장판매", preview.takeoutAmount, preview.takeoutCount)}
            </div>
            {preview.openingCashEnabled && <><hr className="my-3" />{line("시작 준비금", money(preview.openingCash ?? 0))}{line("현금 순변동", money(preview.cashReceived - preview.cashReturned + preview.cashLedgerMovement - preview.otherCashChange))}{line("예상 현금", money(preview.expectedCash ?? 0))}
              <label className="mt-3 flex items-center justify-between gap-3 font-bold">실제 현금<input className="w-40 rounded-lg border border-slate-300 p-2 text-right" min="0" onChange={event => setActual(event.target.value)} type="number" value={actual} /></label>
              {actual.trim() && Number.isSafeInteger(Number(actual)) && line("차액", money(Number(actual) - (preview.expectedCash ?? 0)))}</>}
          </>}
        </>}
        {error && <p className="mt-3 text-red-600" role="alert">{error}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3"><button className="min-h-12 rounded-xl border border-slate-300" disabled={busy} onClick={onClose} type="button">{preview?.blockers.length ? "확인" : "취소"}</button>{preview && !preview.blockers.length && <button className="min-h-12 rounded-xl bg-red-600 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void close()} type="button">영업마감</button>}</div>
      </div>
    </section>
  </div>;
}
