"use client";

import { useEffect, useState } from "react";
import reportStyles from "../sales-report/sales-report.module.css";
import styles from "./business-closings.module.css";

type Session = { sessionId: number; revision?: number; openedAt: string; closedAt: string | null; totalSales: number; saleCount: number;
  discountAmount: number; cardAmount: number; cashAmount: number; otherAmount: number; customerPaymentAmount: number; bankTransferAmount: number;
  cancellationCount: number; refundAmount: number; dineCount: number; takeoutCount: number;
  openingCashEnabled: boolean; openingCash: number | null; expectedCash: number | null; actualCash: number | null; cashDifference: number | null };
type Day = { businessDate: string; totalSales: number; saleCount: number; sessions: Session[] };
const money = (value: number | null) => value === null ? "—" : `${value.toLocaleString("ko-KR")}원`;
const time = (value: string | null) => value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)) : "—";

export default function BusinessClosingsClient() {
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [days, setDays] = useState<Day[]>([]); const [error, setError] = useState(""); const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams(); if (from) params.set("from", from); if (to) params.set("to", to);
      const response = await fetch(`/api/admin/business-closings?${params}`, { cache: "no-store" });
      const result = await response.json() as { success?: boolean; days?: Day[]; message?: string };
      if (!response.ok || !result.success) { setError(result.message ?? "마감 내역을 불러오지 못했습니다."); return; }
      setDays(result.days ?? []);
    } catch { setError("마감 내역을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const line = (label: string, value: string) => <div className={styles.detailLine}><span>{label}</span><strong>{value}</strong></div>;
  return <div className="space-y-4">
    <div className={`${reportStyles.period} ${styles.period}`}>
      <strong>조회기간</strong>
      <div className={`${reportStyles.periodInputs} ${styles.periodInputs}`}>
        <label><input aria-label="시작일" onChange={event => setFrom(event.target.value)} type="date" value={from} /></label>
        <span>~</span>
        <label><input aria-label="종료일" onChange={event => setTo(event.target.value)} type="date" value={to} /></label>
      </div>
      <button className={styles.searchButton} onClick={() => void load()} type="button">조회</button>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.message}>불러오는 중입니다.</p> : !days.length ? <p className={styles.empty}>마감 기록이 없습니다.</p> : days.map(day => <section className={styles.dayCard} key={day.businessDate}>
      <h2>{day.businessDate} · 최종 정산 {money(day.totalSales)} · {day.saleCount}건 · 마감 {day.sessions.length}회</h2>
      <div className={styles.sessions}>{day.sessions.map((session, index) => <details className={styles.session} key={session.sessionId}>
        <summary>{session.revision ?? index + 1}차 마감 · {session.revision ? time(session.closedAt) : `${time(session.openedAt)} ~ ${time(session.closedAt)}`} · {money(session.totalSales)} · {session.saleCount}건</summary>
        <div className={styles.sessionDetails}>{line("총매출", money(session.totalSales))}{line("판매건수", `${session.saleCount}건`)}{line("할인", money(session.discountAmount))}{line("카드", money(session.cardAmount))}{line("현금", money(session.cashAmount))}{line("고객 선불/후불", money(session.customerPaymentAmount))}{line("기타결제", money(session.otherAmount))}{line("기타 중 계좌이체", money(session.bankTransferAmount))}{line("취소·환불", `${session.cancellationCount}건 · ${money(session.refundAmount)}`)}{line("매장 / 포장", `${session.dineCount}건 / ${session.takeoutCount}건`)}
          {session.openingCashEnabled && <>{line("시작 준비금", money(session.openingCash))}{line("예상 현금", money(session.expectedCash))}{line("실제 현금", money(session.actualCash))}{line("차액", money(session.cashDifference))}</>}
        </div>
      </details>)}</div>
    </section>)}
  </div>;
}
