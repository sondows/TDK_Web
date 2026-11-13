"use client";

import { useEffect, useRef, useState } from "react";
import { cashOpeningFundTotal, type CashOpeningFund } from "@/lib/cash-opening-fund";
import { confirmedClosing, validClosing } from "@/lib/business-closing-confirmation";
import { createRequestId } from "@/lib/request-id";
import OpeningFundModal from "./OpeningFundModal";
import AdminBackLink from "./admin/AdminBackLink";
import styles from "./BusinessClosingDialog.module.css";

const money = (value: number) => value.toLocaleString("ko-KR");
const PENDING_CLOSING_KEY = "tdk-pos-pending-business-closing";
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
  // Keep the settlement clock snapshot client-side to avoid an SSR clock mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setReferenceSettlementTime(formatReferenceSettlementTime(new Date())); }, []);
  function rememberRequest(date: string, key: string) {
    try { window.sessionStorage.setItem(PENDING_CLOSING_KEY, JSON.stringify({ date, key })); } catch { /* The ref still keeps this request key. */ }
  }
  function showCompleted(closing: Pick<Preview, "businessDate" | "totalSales" | "saleCount">) {
    try { window.sessionStorage.removeItem(PENDING_CLOSING_KEY); } catch { /* The server has confirmed completion. */ }
    setCompleted(closing);
  }
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
  useEffect(() => {
    if (!preview || completed) return;
    let stored: unknown = null;
    try { stored = JSON.parse(window.sessionStorage.getItem(PENDING_CLOSING_KEY) ?? "null"); } catch { /* Ignore malformed browser storage. */ }
    if (!stored || typeof stored !== "object") return;
    const pending = stored as { date?: unknown; key?: unknown };
    if (pending.date !== preview.businessDate || typeof pending.key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pending.key)) return;
    requestKey.current = pending.key;
    let active = true;
    void confirmedClosing(pending.key).then(closing => { if (active && closing) showCompleted(closing); });
    return () => { active = false; };
  }, [preview, completed]);
  async function close() {
    if (!preview || closingRequest.current) return;
    const actualCash = actualFund === null ? null : cashOpeningFundTotal(actualFund);
    if (preview.openingCashEnabled && (actualCash === null || !Number.isSafeInteger(actualCash) || actualCash < 0)) { setError("시재 확인에서 실제 현금을 입력해 주세요."); return; }
    closingRequest.current = true; setBusy(true); setError("");
    try {
      const retrying = requestKey.current !== null;
      requestKey.current ??= createRequestId();
      const key = requestKey.current;
      rememberRequest(preview.businessDate, key);
      if (retrying) {
        const confirmed = await confirmedClosing(key);
        if (confirmed) { showCompleted(confirmed); return; }
      }
      const response = await fetch("/api/pos/business-session/close", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessDate: preview.businessDate, previousClosingCount: preview.previousClosingCount, requestKey: requestKey.current, actualCash: preview.openingCashEnabled ? actualCash : null, actualCashFund: preview.openingCashEnabled ? actualFund : null }) });
      const result = await response.json() as { success?: boolean; message?: string; closing?: Pick<Preview, "businessDate" | "totalSales" | "saleCount"> };
      if (response.ok && result.success && validClosing(result.closing)) { showCompleted(result.closing); return; }
      const confirmed = await confirmedClosing(key);
      if (confirmed) { showCompleted(confirmed); return; }
      if ((response.status === 400 || response.status === 409) && result.success === false) {
        requestKey.current = null;
        try { window.sessionStorage.removeItem(PENDING_CLOSING_KEY); } catch { /* No persisted request key to clear. */ }
      }
      setError(result.message ?? "마감 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.");
      await refresh(false);
    } catch (error) {
      console.error("Business closing request failed", { requestKey: requestKey.current }, error);
      const confirmed = requestKey.current ? await confirmedClosing(requestKey.current) : null;
      if (confirmed) showCompleted(confirmed);
      else setError("마감 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.");
    }
    finally { closingRequest.current = false; setBusy(false); }
  }
  const line = (label: string, value: string) => <div className="flex items-center justify-between gap-3 py-1"><span>{label}</span><strong className="whitespace-nowrap text-right tabular-nums">{value}</strong></div>;
  const summaryCard = (label: string, value: number, count?: number, primary = false) =>
    <div className={`${styles.summaryCard} ${primary ? styles.primaryCard : ""}`} key={label}>
      <span>{label}</span><strong>{money(value)}{count === undefined ? null : <small>{count}건</small>}</strong>
    </div>;
  return <div className="fixed inset-0 z-[170] flex items-center justify-center bg-slate-950/50 p-2 sm:p-4">
    <section aria-modal="true" className={`${styles.dialog} ${completed ? styles.completedDialog : ""} flex flex-col overflow-hidden`} role={completed ? "alertdialog" : "dialog"}>
      <header className={`flex h-16 shrink-0 items-center gap-[15px] border-b border-[#e2e8eb] pr-5 text-[#25343b] ${completed ? `${styles.completedHeader} pl-6` : "bg-white pl-1"}`}>
        {!completed && <span className="-mr-[13px] flex shrink-0"><AdminBackLink ariaLabel="영업마감 닫기" disabled={busy} iconSize={28} onNavigate={onClose} size={44} title="영업마감 닫기" tone="lightPlain" /></span>}
        <h2 className="min-w-0 truncate text-[19px] font-bold">{completed ? "✓ 영업마감 완료" : preview?.blockers.length ? "영업마감 불가" : "영업마감"}</h2>
      </header>
      <div className={`${styles.body} overflow-y-auto text-sm text-slate-700`}>
        {completed ? <>
          <p className="font-semibold">영업마감이 정상적으로 완료되었습니다.</p>
          <div className="mt-5 space-y-2 rounded-xl border border-slate-200 p-4">
            {line("정산일", `${completed.businessDate}${referenceSettlementTime ? ` ${referenceSettlementTime.slice(11)}` : ""}`)}
            {line("총매출", money(completed.totalSales))}
            {line("판매건수", `(${completed.saleCount})`)}
          </div>
        </> : <>
        {!loaded ? <p>마감 정보를 확인하는 중입니다.</p> : !preview ? <p>{error ? "영업 상태를 확인하지 못했습니다." : "진행 중인 영업이 없습니다."}</p> : <>
          <p className="text-base font-bold">정산일 {preview.businessDate}{referenceSettlementTime ? ` ${referenceSettlementTime.slice(11)}` : ""}</p>
          {preview.previousClosingCount > 0 && <p className="mt-1 text-slate-500">오늘의 이전 마감 ({preview.previousClosingCount})</p>}
          {preview.blockers.length ? <><p className="mt-4 font-bold text-red-700">마감 전 확인할 항목이 있습니다.</p><ul className="mt-3 space-y-2">{preview.blockers.map((row, index) => <li className="rounded-lg bg-red-50 p-2" key={`${row.sessionId}-${index}`}>{row.label} · {row.reason}</li>)}</ul></> : <>
            <div className={`${styles.summaryGrid} mt-4`}>
              {summaryCard("총매출", preview.totalSales, preview.saleCount, true)}
              {summaryCard("할인", preview.discountAmount, preview.discountCount, true)}
            </div>
            <hr className={`${styles.groupDivider} mt-4`} />
            <div className={`${styles.summaryGrid} ${styles.detailGrid} mt-4`}>
              {summaryCard("카드", preview.cardAmount, preview.cardCount)}
              {summaryCard("매장판매", preview.dineAmount, preview.dineCount)}
              {summaryCard("현금", preview.cashAmount, preview.cashCount)}
              {summaryCard("포장판매", preview.takeoutAmount, preview.takeoutCount)}
              {summaryCard("고객결제", preview.customerPaymentAmount, preview.customerPaymentCount)}
              {summaryCard("취소/환불", preview.refundAmount, preview.cancellationCount)}
              {summaryCard("기타결제", preview.otherAmount, preview.otherCount)}
              {summaryCard("영업준비금", preview.openingCash ?? 0)}
            </div>
            {preview.openingCashEnabled && <><hr className={`${styles.groupDivider} mt-4`} /><div className={`${styles.summaryGrid} ${styles.cashGrid} mt-4`}>
              {summaryCard("현금 순변동", preview.cashReceived - preview.cashReturned + preview.cashLedgerMovement - preview.otherCashChange)}
              {summaryCard("예상 현금", preview.expectedCash ?? 0)}
              <div className={`${styles.summaryCard} ${styles.actualCashCard}`}>
                <span>실제 현금</span>
                {actualFund !== null && <small className={styles.cardFootnote}>오차 {signed(cashOpeningFundTotal(actualFund) - (preview.expectedCash ?? 0))}</small>}
                <strong className={styles.actualCashAmount}>{money(actualFund === null ? 0 : cashOpeningFundTotal(actualFund))}</strong>
                <button aria-label="현금시재등록" className={styles.cashRegisterButton} disabled={busy} onClick={() => setCashEntryOpen(true)} type="button">현금시재등록</button>
              </div>
            </div></>}
          </>}
        </>}
        {error && <p className="mt-3 text-red-600" role="alert">{error}</p>}
        </>}
      </div>
      {completed ? <div className={`${styles.footer} ${styles.completedFooter}`}><button className={styles.confirmButton} onClick={onClosed} ref={completionButton} type="button">확인</button></div> :
        preview && !preview.blockers.length ? <div className={styles.footer}>
          <button className={styles.cancelButton} disabled={busy} onClick={onClose} type="button">취소</button>
          <button className={styles.closeButton} disabled={busy} onClick={() => void close()} type="button">{busy ? "마감 처리 중..." : "영업마감"}</button>
        </div> : <div className={styles.footer}><button className={styles.singleButton} disabled={busy} onClick={onClose} type="button">{preview?.blockers.length ? "확인" : "취소"}</button></div>}
    </section>
    {cashEntryOpen && preview && <OpeningFundModal close={() => setCashEntryOpen(false)} expectedCash={preview.expectedCash} initialFund={actualFund} mode="businessClose" onApply={fund => { setActualFund(fund); setCashEntryOpen(false); setError(""); }} />}
  </div>;
}
