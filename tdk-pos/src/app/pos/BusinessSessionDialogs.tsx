"use client";

import { useEffect, useRef, useState } from "react";
import { cashOpeningFundTotal, type CashOpeningFund } from "@/lib/cash-opening-fund";
import OpeningFundModal from "./OpeningFundModal";
import PosSubHeader from "./PosSubHeader";

const money = (value: number) => value.toLocaleString("ko-KR");
const signed = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;
const formatReferenceSettlementTime = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
};
type Preview = {
  businessDate: string; openedAt: string; previousClosingCount: number;
  openingCashEnabled: boolean; openingCash: number | null; expectedCash: number | null;
  blockers: Array<{ sessionId: number; label: string; reason: string }>;
  totalSales: number; saleCount: number; discountAmount: number; discountCount: number;
  cardAmount: number; cardCount: number; cashAmount: number; cashCount: number;
  otherAmount: number; otherCount: number; customerPaymentAmount: number; customerPaymentCount: number;
  bankTransferAmount: number; cancellationCount: number; refundAmount: number;
  dineCount: number; dineAmount: number; takeoutCount: number; takeoutAmount: number;
  cashReceived: number; cashReturned: number; cashLedgerMovement: number; otherCashChange: number;
};

export function BusinessClosingDialog({ onClose, onClosed }: { onClose: () => void; onClosed: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [completed, setCompleted] = useState<Pick<Preview, "businessDate" | "totalSales" | "saleCount"> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [referenceSettlementTime, setReferenceSettlementTime] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [actualFund, setActualFund] = useState<CashOpeningFund | null>(null);
  const [cashEntryOpen, setCashEntryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const closingRequest = useRef(false);
  const requestKey = useRef<string | null>(null);
  const completionButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (completed) completionButton.current?.focus(); }, [completed]);
  useEffect(() => { setReferenceSettlementTime(formatReferenceSettlementTime(new Date())); }, []);
  async function refresh(clearError = true) {
    if (clearError) setError("");
    try {
      const response = await fetch("/api/pos/business-session/close", { cache: "no-store" });
      const data = await response.json() as { success?: boolean; preview?: Preview | null; message?: string };
      if (!response.ok || !data.success) { if (clearError) setError(data.message ?? "마감 정보를 불러오지 못했습니다."); return; }
      setPreview(data.preview ?? null);
    } catch { if (clearError) setError("마감 정보를 불러오지 못했습니다."); }
    finally { setLoaded(true); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, []);
  async function close() {
    if (!preview || closingRequest.current) return;
    const actualCash = actualFund === null ? null : cashOpeningFundTotal(actualFund);
    if (preview.openingCashEnabled && (actualCash === null || !Number.isSafeInteger(actualCash) || actualCash < 0)) { setError("시재 확인에서 실제 현금을 입력해 주세요."); return; }
    closingRequest.current = true; setBusy(true); setError("");
    try {
      requestKey.current ??= crypto.randomUUID();
      const response = await fetch("/api/pos/business-session/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessDate: preview.businessDate, previousClosingCount: preview.previousClosingCount, requestKey: requestKey.current, actualCash: preview.openingCashEnabled ? actualCash : null, actualCashFund: preview.openingCashEnabled ? actualFund : null }) });
      const result = await response.json() as { success?: boolean; message?: string; closing?: Pick<Preview, "businessDate" | "totalSales" | "saleCount"> };
      if (!response.ok || !result.success) { requestKey.current = null; setError(result.message ?? "영업마감에 실패했습니다. 다시 확인해 주세요."); await refresh(false); return; }
      if (!result.closing) { setError("영업마감 결과를 확인하지 못했습니다. 영업 상태를 다시 확인해 주세요."); await refresh(false); return; }
      setCompleted(result.closing);
    } catch { setError("영업마감 결과를 확인하지 못했습니다. 영업 상태를 다시 확인해 주세요."); }
    finally { closingRequest.current = false; setBusy(false); }
  }
  const line = (label: string, value: string) => <div className="flex items-center justify-between gap-3 py-1"><span>{label}</span><strong className="whitespace-nowrap text-right tabular-nums">{value}</strong></div>;
  const summaryLine = (label: string, value: number, count: number) =>
    <div className="flex items-center justify-between gap-3 py-1"><span className="whitespace-nowrap">{label}</span><strong className="grid grid-cols-[auto_3.5rem] items-baseline gap-1 whitespace-nowrap tabular-nums"><span className="text-right">{money(value)}</span><span className="text-right">({count})</span></strong></div>;
  return <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/50 p-4">
    <section aria-modal="true" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[26rem] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role={completed ? "alertdialog" : "dialog"}>
      <PosSubHeader backLabel="영업마감 닫기" disabled={busy} onBack={onClose} showBackButton={!completed} className={completed ? "!pl-6" : ""} title={completed ? "✓ 영업마감 완료" : preview?.blockers.length ? "영업마감 불가" : "영업마감"} />
      <div className="overflow-y-auto p-6 text-sm text-slate-700">
        {completed ? <>
          <p className="font-semibold">영업마감이 정상적으로 완료되었습니다.</p>
          <div className="mt-5 space-y-2 rounded-xl border border-slate-200 p-4">
            {line("정산일", `${completed.businessDate}${referenceSettlementTime ? ` ${referenceSettlementTime.slice(11)}` : ""}`)}
            {line("총매출", money(completed.totalSales))}
            {line("판매건수", `(${completed.saleCount})`)}
          </div>
          <div className="mt-6 flex justify-end"><button className="min-h-12 min-w-24 rounded-xl bg-blue-600 px-5 font-bold text-white" onClick={onClosed} ref={completionButton} type="button">확인</button></div>
        </> : <>
        {!loaded ? <p>마감 정보를 확인하는 중입니다.</p> : !preview ? <p>{error ? "영업 상태를 확인하지 못했습니다." : "진행 중인 영업이 없습니다."}</p> : <>
          <p className="text-base font-bold">정산일 {preview.businessDate}{referenceSettlementTime ? ` ${referenceSettlementTime.slice(11)}` : ""}</p>
          {preview.previousClosingCount > 0 && <p className="mt-1 text-slate-500">오늘의 이전 마감 ({preview.previousClosingCount})</p>}
          {preview.blockers.length ? <><p className="mt-4 font-bold text-red-700">마감 전 확인할 항목이 있습니다.</p><ul className="mt-3 space-y-2">{preview.blockers.map((row, index) => <li className="rounded-lg bg-red-50 p-2" key={`${row.sessionId}-${index}`}>{row.label} · {row.reason}</li>)}</ul></> : <>
            <div className="mt-4">
              {summaryLine("총매출", preview.totalSales, preview.saleCount)}
              {summaryLine("할인", preview.discountAmount, preview.discountCount)}
              <hr className="my-3" />
              {summaryLine("카드", preview.cardAmount, preview.cardCount)}
              {summaryLine("현금", preview.cashAmount, preview.cashCount)}
              {summaryLine("고객결제", preview.customerPaymentAmount, preview.customerPaymentCount)}
              {summaryLine("기타결제", preview.otherAmount, preview.otherCount)}
              <hr className="my-3" />
              {summaryLine("매장판매", preview.dineAmount, preview.dineCount)}
              {summaryLine("포장판매", preview.takeoutAmount, preview.takeoutCount)}
              {summaryLine("취소/환불", preview.refundAmount, preview.cancellationCount)}
            </div>
            {preview.openingCashEnabled && <><hr className="my-3" />{line("영업 준비금", money(preview.openingCash ?? 0))}{line("현금 순변동", money(preview.cashReceived - preview.cashReturned + preview.cashLedgerMovement - preview.otherCashChange))}{line("예상 현금", money(preview.expectedCash ?? 0))}
              <div className="mt-3 flex items-center justify-between gap-3 font-bold"><span>실제 현금</span><button aria-label="실제 현금 시재 입력" className="min-w-40 rounded-lg border border-slate-300 bg-white p-2 text-right tabular-nums hover:bg-slate-50" disabled={busy} onClick={() => setCashEntryOpen(true)} type="button">{money(actualFund === null ? 0 : cashOpeningFundTotal(actualFund))}</button></div>
              {actualFund !== null && line("오차", signed(cashOpeningFundTotal(actualFund) - (preview.expectedCash ?? 0)))}</>}
          </>}
        </>}
        {error && <p className="mt-3 text-red-600" role="alert">{error}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3"><button className="min-h-12 rounded-xl border border-slate-300" disabled={busy} onClick={onClose} type="button">{preview?.blockers.length ? "확인" : "취소"}</button>{preview && !preview.blockers.length && <button className="min-h-12 rounded-xl bg-red-600 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void close()} type="button">{busy ? "마감 처리 중..." : "영업마감"}</button>}</div>
        </>}
      </div>
    </section>
    {cashEntryOpen && preview && <OpeningFundModal close={() => setCashEntryOpen(false)} expectedCash={preview.expectedCash} initialFund={actualFund} mode="businessClose" onApply={fund => { setActualFund(fund); setCashEntryOpen(false); setError(""); }} />}
  </div>;
}
