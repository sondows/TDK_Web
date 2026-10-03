"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerSummary } from "@/lib/customer";
import { formatTradeBalance, tradeDescription, type CustomerTradeResponse, type CustomerTradeRow } from "@/lib/customer-trade";
import CustomerTradeEntryModal, { type TradeAction } from "./CustomerTradeEntryModal";
import styles from "../admin.module.css";

function customerLabel(customer: CustomerSummary) {
  const name = customer.name.trim();
  return name ? customer.contactName ? `${name} (${customer.contactName})` : name : customer.phone ?? "—";
}

function tradeTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

export default function CustomerTradeModal({ customer, onChanged, onClose }: {
  customer: CustomerSummary;
  onChanged: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [balance, setBalance] = useState(customer.tradeBalance);
  const [entries, setEntries] = useState<CustomerTradeRow[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliedStart, setAppliedStart] = useState("");
  const [appliedEnd, setAppliedEnd] = useState("");
  const [action, setAction] = useState<TradeAction | null>(null);
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

  return (
    <dialog aria-labelledby="customer-trade-title" className={styles.customerTradeModal}
      onCancel={event => { if (action) { event.preventDefault(); return; } onClose(); }} ref={dialogRef}>
      <div className={styles.customerTradeHeader}>
        <button aria-label="거래관리 닫기" className={styles.customerTradeBack} onClick={onClose} type="button">←</button>
        <h2 id="customer-trade-title">거래관리</h2>
        <span className={styles.customerTradeCustomer}>{customerLabel(customer)}</span>
      </div>
      <div className={styles.customerTradeBody}>
        <div className={styles.customerTradeSummary}>
          <span>현재 거래잔액</span>
          <strong className={balance > 0 ? styles.customerPositiveBalance : balance < 0 ? styles.customerNegativeBalance : styles.customerZeroBalance}>{formatTradeBalance(balance)}</strong>
        </div>
        <div className={styles.customerTradeActions}>
          <button onClick={() => setAction("DEPOSIT")} type="button">입금</button>
          <button disabled={balance <= 0} onClick={() => setAction("REFUND")} type="button">환불</button>
          <button onClick={() => setAction("ADJUSTMENT")} type="button">잔액조정</button>
        </div>
        <div className={styles.customerTradeFilters}>
          <span>기간</span>
          <input aria-label="시작일" onChange={event => setStartDate(event.target.value)} type="date" value={startDate} />
          <span>~</span>
          <input aria-label="종료일" onChange={event => setEndDate(event.target.value)} type="date" value={endDate} />
          <button onClick={() => { setStartDate(""); setEndDate(""); setAppliedStart(""); setAppliedEnd(""); setRefreshKey(key => key + 1); }} type="button">전체</button>
          <button onClick={applyRange} type="button">조회</button>
        </div>
        {error && <p className={styles.customerTradeError} role="alert">{error}</p>}
        <div className={styles.customerTradeTableScroll}>
          <table className={styles.customerTradeTable}>
            <thead><tr><th>날짜/시간</th><th>내용</th><th>입금</th><th>출금</th><th>잔액</th></tr></thead>
            <tbody>
              {loading || error || !entries.length ? <tr><td className={styles.customerTradeEmpty} colSpan={5}>{loading ? "거래내역을 불러오는 중입니다." : error || "거래내역이 없습니다."}</td></tr> : entries.map(entry => (
                <tr key={entry.ledgerId}>
                  <td>{tradeTime(entry.transactionAt)}</td>
                  <td>
                    <span>{tradeDescription(entry)}</span>
                    {entry.memo && <small className={styles.customerTradeMemo}>{entry.memo}</small>}
                    {entry.paymentId && <small className={styles.customerTradeMemo}>결제 #{entry.paymentId}{entry.checkoutId ? ` · 거래 #${entry.checkoutId}` : ""}</small>}
                  </td>
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
    </dialog>
  );
}
