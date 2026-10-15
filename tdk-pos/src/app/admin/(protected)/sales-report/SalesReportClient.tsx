"use client";

import { useEffect, useState } from "react";
import AdminBackLink from "@/app/pos/admin/AdminBackLink";
import { SaleDetailDialog } from "@/app/pos/sales/SalesHistoryClient";
import type { SaleDetail, SaleDetailResponse, SaleDisplayStatus } from "@/lib/sales-types";
import admin from "../../admin.module.css";
import styles from "./sales-report.module.css";

type View = "yearly" | "monthly" | "daily" | "detail";
type Source = "LEGACY_POS" | "TDK_POS" | "MIXED" | null;
type Row = {
  label: string; date: string; source: Source; overlapDays: number;
  salesAmount: number; saleCount: number; discountAmount: number;
  cardAmount: number; cashAmount: number; bankTransferAmount: number; otherAmount: number;
  customerAverage: number | null; tableAverage: number | null;
  durationMinutes: number | null; tableGuestAverage: number | null;
};
type Report = { success: boolean; view: View; rows: Row[]; totals: Row; overlapDays: number; message?: string };
type DetailRow = { checkoutId: number; occurredAt: string; tableLabel: string; salesAmount: number; paymentMethods: string; status: SaleDisplayStatus; source: "TDK_POS" };
type Details = { success: boolean; rows: DetailRow[]; page: number; pageSize: number; totalCount: number; message?: string };
const todayInKorea = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const firstOfMonth = (date: string) => `${date.slice(0, 7)}-01`;
const lastOfMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const amount = (value: number | null) => value === null ? "-" : Math.round(value).toLocaleString("ko-KR");
const sourceName = (source: Source) => source === "LEGACY_POS" ? "구 POS" : source === "TDK_POS" ? "TDK-POS" : source === "MIXED" ? "기간 혼합" : "-";
const statusName: Record<SaleDisplayStatus, string> = { COMPLETED: "완료", PARTIALLY_CANCELLED: "일부취소", CANCELLED: "취소", IN_PROGRESS: "진행중" };

export default function SalesReportClient() {
  const [view, setView] = useState<View>("daily");
  const [startDate, setStartDate] = useState(() => firstOfMonth(todayInKorea()));
  const [endDate, setEndDate] = useState(todayInKorea);
  const [report, setReport] = useState<Report | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [page, setPage] = useState(1);
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const validRange = validDate(startDate) && validDate(endDate) && startDate <= endDate;
  const yearOptions = Array.from({ length: Number(todayInKorea().slice(0, 4)) - 2017 + 11 }, (_, index) => 2017 + index);

  useEffect(() => {
    if (!validRange) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ view, startDate, endDate });
    fetch(`/api/admin/sales-report?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json() as Report;
        if (!response.ok || !body.success) throw new Error(body.message ?? "매출조회를 불러오지 못했습니다.");
        setReport(body); setError("");
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "매출조회를 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, startDate, endDate, validRange]);

  useEffect(() => {
    if (view !== "detail" || !validRange) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ startDate, endDate, page: String(page) });
    fetch(`/api/admin/sales-report/details?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json() as Details;
        if (!response.ok || !body.success) throw new Error(body.message ?? "판매건 목록을 불러오지 못했습니다.");
        setDetails(body); setDetailError("");
      })
      .catch(cause => { if (!controller.signal.aborted) setDetailError(cause instanceof Error ? cause.message : "판매건 목록을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [view, startDate, endDate, page, validRange]);

  const updateRange = (start: string, end: string) => {
    setStartDate(start); setEndDate(end); setPage(1); setReport(null); setDetails(null);
    setLoading(true); setDetailLoading(true); setError(""); setDetailError("");
  };
  const changeView = (next: View) => {
    if (next === view) return;
    const start = next === "yearly" ? `${startDate.slice(0, 4)}-01-01` : next === "monthly" ? firstOfMonth(startDate) : startDate;
    const end = next === "yearly" ? `${endDate.slice(0, 4)}-12-31` : next === "monthly" ? lastOfMonth(endDate.slice(0, 7)) : endDate;
    setView(next); updateRange(start, end);
  };
  const openDetail = async (checkoutId: number) => {
    setDetailError("");
    try {
      const response = await fetch(`/api/admin/dashboard?checkoutId=${checkoutId}`, { cache: "no-store" });
      const body = await response.json() as SaleDetailResponse;
      if (!response.ok || !body.success || !body.sale) throw new Error(body.message ?? "판매 상세를 불러오지 못했습니다.");
      setSale(body.sale);
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : "판매 상세를 불러오지 못했습니다."); }
  };
  const drillDay = (date: string) => { setView("detail"); updateRange(date, date); };
  const totals = report?.totals;
  const summary = [
    ["매출", totals ? `${amount(totals.salesAmount)}원` : "-"],
    ["판매건수", totals ? `${amount(totals.saleCount)}건` : "-"],
    ["할인", totals ? `${amount(totals.discountAmount)}원` : "-"],
    ["객단가", totals?.customerAverage == null ? "-" : `${amount(totals.customerAverage)}원`],
    ["테이블단가", totals?.tableAverage == null ? "-" : `${amount(totals.tableAverage)}원`],
    ["평균 이용시간", totals?.durationMinutes == null ? "-" : `${amount(totals.durationMinutes)}분`],
    ["평균 테이블인원", totals?.tableGuestAverage == null ? "-" : `${totals.tableGuestAverage.toFixed(1)}명`],
  ];

  return <div className={admin.content}>
    <div className={styles.heading}><div className={styles.headingTitle}><AdminBackLink ariaLabel="관리센터로 돌아가기" size={40} iconSize={20} /><h1>매출조회</h1></div>
      <div aria-label="매출조회 단위" className={styles.tabs} role="tablist">
        {([['yearly', '년별'], ['monthly', '월별'], ['daily', '일별'], ['detail', '상세']] as const).map(([key, label]) =>
          <button aria-selected={view === key} className={`${styles.tab} ${view === key ? styles.tabActive : ""}`} key={key} onClick={() => changeView(key)} role="tab" type="button">{label}</button>)}
      </div></div>
    <section className={styles.period} aria-label="조회기간"><strong>조회기간</strong>
      {view === "yearly" ? <div className={styles.periodInputs}><label>시작 연도<select aria-label="시작 연도" onChange={event => updateRange(`${event.target.value}-01-01`, endDate)} value={startDate.slice(0, 4)}>{yearOptions.map(year => <option key={year} value={year}>{year}년</option>)}</select></label><span>~</span><label>종료 연도<select aria-label="종료 연도" onChange={event => updateRange(startDate, `${event.target.value}-12-31`)} value={endDate.slice(0, 4)}>{yearOptions.map(year => <option key={year} value={year}>{year}년</option>)}</select></label></div>
        : view === "monthly" ? <div className={styles.periodInputs}><label>시작 년월<input aria-label="시작 년월" onChange={event => { if (event.target.value) updateRange(`${event.target.value}-01`, endDate); }} type="month" value={startDate.slice(0, 7)} /></label><span>~</span><label>종료 년월<input aria-label="종료 년월" onChange={event => { if (event.target.value) updateRange(startDate, lastOfMonth(event.target.value)); }} type="month" value={endDate.slice(0, 7)} /></label></div>
          : <div className={styles.periodInputs}><label>시작일<input aria-label="시작일" onChange={event => updateRange(event.target.value, endDate)} type="date" value={startDate} /></label><span>~</span><label>종료일<input aria-label="종료일" onChange={event => updateRange(startDate, event.target.value)} type="date" value={endDate} /></label></div>}
    </section>
    {!validRange && <p className={styles.error} role="alert">시작일과 종료일을 확인해 주세요.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <section aria-label="기간 집계" className={styles.summary}>{summary.map(([label, value]) => <div className={styles.summaryItem} key={label}><span>{label}</span><strong>{loading ? "-" : value}</strong></div>)}</section>
    {report && report.overlapDays > 0 && <p className={styles.note}>두 출처가 겹치는 {report.overlapDays}일은 구 POS 집계만 반영했습니다.</p>}
    {view === "detail" ? <>
      <p className={styles.note}>구 POS는 일별 집계만 보관되어 개별 판매건을 표시할 수 없습니다. 아래 목록은 TDK-POS 판매건입니다.</p>
      {detailError && <p className={styles.error} role="alert">{detailError}</p>}
      <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th className={styles.dateCell}>일시</th><th className={styles.dateCell}>테이블/구분</th><th>금액</th><th className={styles.dateCell}>결제수단</th><th className={styles.dateCell}>상태</th></tr></thead>
        <tbody>{details?.rows.map(row => <tr className={styles.clickable} key={row.checkoutId} onClick={() => void openDetail(row.checkoutId)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openDetail(row.checkoutId); } }} role="button" tabIndex={0}><td className={styles.dateCell}>{row.occurredAt.slice(0, 16).replace("T", " ")}</td><td className={styles.dateCell}>{row.tableLabel}</td><td className={styles.mainAmount}>{amount(row.salesAmount)}</td><td className={styles.dateCell}>{row.paymentMethods}</td><td className={styles.dateCell}>{statusName[row.status]}</td></tr>)}</tbody></table>
        {detailLoading && <p className={styles.empty}>불러오는 중...</p>}
        {!detailLoading && !details?.rows.length && <p className={styles.empty}>표시할 TDK-POS 판매건이 없습니다.</p>}
      </div>
      {details && details.totalCount > details.pageSize && <div className={styles.pagination}><button disabled={page <= 1 || detailLoading} onClick={() => { setPage(value => value - 1); setDetails(null); setDetailLoading(true); }} type="button">이전</button><span>{page} / {Math.ceil(details.totalCount / details.pageSize)}</span><button disabled={page * details.pageSize >= details.totalCount || detailLoading} onClick={() => { setPage(value => value + 1); setDetails(null); setDetailLoading(true); }} type="button">다음</button></div>}
    </> : <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th className={styles.dateCell}>{view === "yearly" ? "연도" : view === "monthly" ? "년월" : "날짜"}</th><th>매출</th><th>판매건수</th><th>할인</th><th>객단가</th><th>테이블단가</th><th>평균 이용시간</th><th>평균 인원</th><th className={styles.sourceCell}>출처</th></tr></thead>
      <tbody>{report?.rows.map(row => <tr className={view === "daily" ? styles.clickable : ""} data-source={row.source ?? "NONE"} key={row.date} onClick={view === "daily" ? () => drillDay(row.date) : undefined} onKeyDown={view === "daily" ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); drillDay(row.date); } } : undefined} role={view === "daily" ? "button" : undefined} tabIndex={view === "daily" ? 0 : undefined}><th className={styles.dateCell}>{row.label}</th><td className={styles.mainAmount}>{amount(row.salesAmount)}</td><td>{amount(row.saleCount)}</td><td>{amount(row.discountAmount)}</td><td>{amount(row.customerAverage)}</td><td>{amount(row.tableAverage)}</td><td>{amount(row.durationMinutes)}</td><td>{row.tableGuestAverage == null ? "-" : row.tableGuestAverage.toFixed(1)}</td><td className={styles.sourceCell}>{sourceName(row.source)}</td></tr>)}</tbody>
      {totals && <tfoot><tr><th className={styles.dateCell}>합계</th><td>{amount(totals.salesAmount)}</td><td>{amount(totals.saleCount)}</td><td>{amount(totals.discountAmount)}</td><td>{amount(totals.customerAverage)}</td><td>{amount(totals.tableAverage)}</td><td>{amount(totals.durationMinutes)}</td><td>{totals.tableGuestAverage == null ? "-" : totals.tableGuestAverage.toFixed(1)}</td><td className={styles.sourceCell}>-</td></tr></tfoot>}
      </table>{loading && <p className={styles.empty}>불러오는 중...</p>}</div>}
    {sale && <SaleDetailDialog close={() => setSale(null)} sale={sale} />}
  </div>;
}
