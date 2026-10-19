"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerSummary } from "@/lib/customer";
import { formatTradeBalance, tradeDescription, type CustomerTradeResponse, type CustomerTradeRow } from "@/lib/customer-trade";
import CustomerTradeDetailModal from "./CustomerTradeDetailModal";
import CustomerTradeEntryModal, { type TradeAction } from "./CustomerTradeEntryModal";
import AdminBackLink from "@/app/pos/admin/AdminBackLink";
import { useAdminReadOnly } from "../AdminAccessContext";
import StaffToggle from "../staff/StaffToggle";
import styles from "../admin.module.css";

function customerLabel(customer: CustomerSummary) {
  const name = customer.name.trim();
  return name ? customer.contactName ? `${name} (${customer.contactName})` : name : customer.phone ?? "—";
}

function tradeTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function todayInKorea() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function currentMonthRange() {
  const today = todayInKorea();
  return { start: `${today.slice(0, 7)}-01`, end: today };
}

export default function CustomerTradeModal({ customer, onChanged, onClose }: {
  customer: CustomerSummary;
  onChanged: () => void;
  onClose: () => void;
}) {
  const readOnly = useAdminReadOnly();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [initialRange] = useState(currentMonthRange);
  const [balance, setBalance] = useState(customer.tradeBalance);
  const [entries, setEntries] = useState<CustomerTradeRow[]>([]);
  const [hideableLedgerIds, setHideableLedgerIds] = useState<number[]>([]);
  const [hideCancelled, setHideCancelled] = useState(true);
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [appliedStart, setAppliedStart] = useState(initialRange.start);
  const [appliedEnd, setAppliedEnd] = useState(initialRange.end);
  const [action, setAction] = useState<TradeAction | null>(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (appliedStart) query.set("startDate", appliedStart);
      if (appliedEnd) query.set("endDate", appliedEnd);
      const response = await fetch(`/api/customers/${customer.customerId}/ledger?${query}`, { cache: "no-store", signal });
      const result = await response.json() as CustomerTradeResponse;
      if (!response.ok || !result.success) throw new Error(result.message ?? "거래내역을 불러오지 못했습니다.");
      if (signal.aborted) return;
      setBalance(result.balance);
      setEntries(result.entries);
      setHideableLedgerIds(result.hideableLedgerIds);
    } catch (caught) {
      if (!signal.aborted) setError(caught instanceof Error ? caught.message : "거래내역을 불러오지 못했습니다.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [customer.customerId, appliedStart, appliedEnd]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void load(controller.signal); }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load, refreshKey]);

  const applyRange = () => {
    if (startDate && endDate && startDate > endDate) {
      setError("조회 기간을 확인해 주세요.");
      return;
    }
    setAppliedStart(startDate);
    setAppliedEnd(endDate);
    setRefreshKey(key => key + 1);
  };
  const selectRange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    setAppliedStart(start);
    setAppliedEnd(end);
    setError("");
    setRefreshKey(key => key + 1);
  };
  const today = todayInKorea();
  const recent30Start = shiftDate(today, -29);
  const recent90Start = shiftDate(today, -89);
  const activeRange = !startDate && !endDate ? "all"
    : startDate === `${today.slice(0, 7)}-01` && endDate === today ? "month"
      : startDate === recent30Start && endDate === today ? "30"
        : startDate === recent90Start && endDate === today ? "90"
          : null;
  const hiddenIds = new Set(hideCancelled ? hideableLedgerIds : []);
  const visibleEntries = entries.filter(entry => !hiddenIds.has(entry.ledgerId));

  return (
    <dialog aria-labelledby="customer-trade-title" className={styles.customerTradeModal}
      onCancel={event => { if (action || selectedLedgerId !== null) { event.preventDefault(); return; } onClose(); }} ref={dialogRef}>
      <div className={`${styles.customerTradeHeader} ${styles.customerTradeHeaderMain}`}>
        <div className={styles.customerTradeTitle}>
          <AdminBackLink ariaLabel="거래관리 닫기" iconSize={28} onNavigate={onClose} size={44} title="거래관리 닫기" tone="lightPlain" />
          <h2 id="customer-trade-title">거래관리</h2>
        </div>
        <span className={styles.customerTradeCustomer}>{customerLabel(customer)}</span>
      </div>
      <div className={styles.customerTradeBody}>
        <div className={styles.customerTradeTopGrid}>
          <section aria-label="거래 조회 기간" className={styles.customerTradeRangePanel}>
            <div className={styles.customerTradeDateRow}>
              <span>기간</span>
              <input aria-label="시작일" onChange={event => setStartDate(event.target.value)} type="date" value={startDate} />
              <span>~</span>
              <input aria-label="종료일" onChange={event => setEndDate(event.target.value)} type="date" value={endDate} />
              <button onClick={applyRange} type="button">조회</button>
              <div className={styles.customerTradeFilterToggle}>
                <StaffToggle checked={hideCancelled} label="취소 거래 숨김" onChange={setHideCancelled} variant="customer" />
              </div>
            </div>
            <div aria-label="빠른 기간 선택" className={styles.customerTradePresets}>
              <button aria-pressed={activeRange === "all"} className={activeRange === "all" ? styles.customerTradePresetActive : undefined} onClick={() => selectRange("", "")} type="button">전체</button>
              <button aria-pressed={activeRange === "90"} className={activeRange === "90" ? styles.customerTradePresetActive : undefined} onClick={() => selectRange(recent90Start, today)} type="button">최근 90일</button>
              <button aria-pressed={activeRange === "30"} className={activeRange === "30" ? styles.customerTradePresetActive : undefined} onClick={() => selectRange(recent30Start, today)} type="button">최근 30일</button>
              <button aria-pressed={activeRange === "month"} className={activeRange === "month" ? styles.customerTradePresetActive : undefined} onClick={() => selectRange(`${today.slice(0, 7)}-01`, today)} type="button">당월</button>
            </div>
          </section>
          <section aria-label="현재 거래잔액 및 조작" className={styles.customerTradeAccountPanel}>
            <div className={styles.customerTradeSummary}>
              <span>현재 거래잔액</span>
              <strong className={balance > 0 ? styles.customerPositiveBalance : balance < 0 ? styles.customerNegativeBalance : styles.customerZeroBalance}>{formatTradeBalance(balance)}</strong>
            </div>
            {!readOnly && <div className={styles.customerTradeActions}>
              <button onClick={() => setAction("DEPOSIT")} type="button">입금</button>
              <button disabled={balance <= 0} onClick={() => setAction("REFUND")} type="button">환불</button>
              <button onClick={() => setAction("ADJUSTMENT")} type="button">잔액조정</button>
            </div>}
          </section>
        </div>
        {error && <p className={styles.customerTradeError} role="alert">{error}</p>}
        <div className={styles.customerTradeTableScroll}>
          <table className={styles.customerTradeTable}>
            <thead><tr><th>날짜/시간</th><th>내용</th><th>입금</th><th>출금</th><th>잔액</th></tr></thead>
            <tbody>
              {loading || error || !visibleEntries.length ? <tr><td className={styles.customerTradeEmpty} colSpan={5}>{loading ? "거래내역을 불러오는 중입니다." : error || "표시할 거래내역이 없습니다."}</td></tr> : visibleEntries.map(entry => (
                <tr aria-label={`${tradeTime(entry.transactionAt)} ${tradeDescription(entry)} 거래 상세 보기`}
                  className={styles.customerTradeRow} key={entry.ledgerId}
                  onClick={() => setSelectedLedgerId(entry.ledgerId)}
                  onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedLedgerId(entry.ledgerId); } }}
                  role="button" tabIndex={0}>
                  <td>{tradeTime(entry.transactionAt)}</td>
                  <td>{tradeDescription(entry)}</td>
                  <td>{entry.amount > 0 ? entry.amount.toLocaleString("ko-KR") : ""}</td>
                  <td>{entry.amount < 0 ? Math.abs(entry.amount).toLocaleString("ko-KR") : ""}</td>
                  <td className={entry.balance > 0 ? styles.customerPositiveBalance : entry.balance < 0 ? styles.customerNegativeBalance : styles.customerZeroBalance}>{formatTradeBalance(entry.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {action && <CustomerTradeEntryModal action={action} balance={balance} customer={customer} onClose={() => setAction(null)} onSaved={() => { setAction(null); setRefreshKey(key => key + 1); onChanged(); }} />}
      {selectedLedgerId !== null && <CustomerTradeDetailModal customerId={customer.customerId} ledgerId={selectedLedgerId} onClose={() => setSelectedLedgerId(null)} />}
    </dialog>
  );
}
