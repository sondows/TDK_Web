"use client";

import { useEffect, useMemo, useState } from "react";
import { SaleDetailDialog } from "@/app/pos/sales/SalesHistoryClient";
import SortableHeader from "@/app/admin/SortableHeader";
import { nextGridSort, sortGridRows, type GridSortState } from "@/lib/admin-grid-sort";
import type { SaleDetail, SaleDetailResponse, SaleDisplayStatus } from "@/lib/sales-types";
import { defaultSalesReportRange, salesReportPresets, type SalesReportPreset, type SalesReportRange } from "@/lib/sales-report-period";
import admin from "../../admin.module.css";
import styles from "./sales-report.module.css";

type View = "yearly" | "monthly" | "daily" | "detail";
type Source = "LEGACY_POS" | "TDK_POS" | "MIXED" | null;
type Row = {
  label: string; date: string; source: Source; overlapDays: number;
  salesAmount: number; saleCount: number; discountAmount: number;
  cardAmount: number; cashAmount: number; bankTransferAmount: number; otherAmount: number;
  salesDayCount: number; dailySalesAverage: number | null; dailySaleCountAverage: number | null;
  discountCount: number | null; takeoutAmount: number | null; takeoutCount: number | null;
  customerAverage: number | null; tableAverage: number | null;
  durationMinutes: number | null; tableGuestAverage: number | null;
};
type Report = { success: boolean; view: View; rows: Row[]; totals: Row; overlapDays: number; message?: string };
type DetailRow = { checkoutId: number; occurredAt: string; tableLabel: string; salesAmount: number; paymentMethods: string; status: SaleDisplayStatus; source: "TDK_POS" };
type Details = { success: boolean; rows: DetailRow[]; page: number; pageSize: number; totalCount: number; message?: string };
const DETAIL_COLUMN_WIDTHS = {
  occurredAt: 170,
  tableLabel: 140,
  amount: 100,
  paymentMethods: 250,
  status: 150,
} as const;
const DETAIL_COLUMN_GAP = 20;
const COLUMN_WIDTHS = {
  period: 100,
  sales: 130,
  salesDays: 100,
  dailyAverage: 120,
  saleCount: 100,
  discount: 100,
  customerAverage: 100,
  tableAverage: 100,
  duration: 100,
  guests: 100,
} as const;
const DAILY_COLUMN_WIDTHS = {
  period: 100,
  sales: 130,
  saleCount: 100,
  discount: 100,
  customerAverage: 100,
  tableAverage: 100,
  duration: 110,
  guests: 100,
} as const;
type ReportColumn = keyof typeof COLUMN_WIDTHS;
type SortColumn = "period" | "sales" | "salesDays" | "dailyAverage" | "saleCount" | "discount" | "customerAverage" | "tableAverage" | "duration" | "guests";
type DetailSortColumn = "occurredAt" | "tableLabel" | "amount" | "paymentMethods" | "status";
const reportSortTypes = { period: "date", sales: "number", salesDays: "number", dailyAverage: "number", saleCount: "number", discount: "number", customerAverage: "number", tableAverage: "number", duration: "number", guests: "number" } as const;
const summaryColumns: ReportColumn[] = ["period", "sales", "salesDays", "dailyAverage", "saleCount", "discount", "customerAverage", "tableAverage", "duration", "guests"];
const dailyColumns: ReportColumn[] = summaryColumns.filter(column => column !== "salesDays" && column !== "dailyAverage");
const todayInKorea = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const lastOfMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const amount = (value: number | null) => value === null ? "-" : Math.round(value).toLocaleString("ko-KR");
const dailyDateLabel = (date: string) => {
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${date.slice(5).replace("-", "/")} (${weekday})`;
};
const statusName: Record<SaleDisplayStatus, string> = { COMPLETED: "완료", PARTIALLY_CANCELLED: "일부취소", CANCELLED: "취소", IN_PROGRESS: "진행중" };

export default function SalesReportClient() {
  const [view, setView] = useState<View>("daily");
  const [today, setToday] = useState(todayInKorea);
  const [ranges, setRanges] = useState<Partial<Record<View, SalesReportRange>>>(() => ({ daily: defaultSalesReportRange("daily", todayInKorea()) }));
  const [firstAvailableDate, setFirstAvailableDate] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [selectedPresets, setSelectedPresets] = useState<Partial<Record<View, SalesReportPreset["id"]>>>({ daily: "current" });
  const [report, setReport] = useState<Report | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [page, setPage] = useState(1);
  const [reportSort, setReportSort] = useState<GridSortState<SortColumn>>({ key: "period", direction: "desc" });
  const [detailSort, setDetailSort] = useState<GridSortState<DetailSortColumn>>({ key: "occurredAt", direction: "desc" });
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const { startDate, endDate } = ranges[view] ?? defaultSalesReportRange(view, today);
  const validRange = validDate(startDate) && validDate(endDate) && startDate <= endDate;
  const firstSelectableYear = Math.min(Number(firstAvailableDate?.slice(0, 4) ?? today.slice(0, 4)), Number(startDate.slice(0, 4)));
  const yearOptions = Array.from({ length: Number(today.slice(0, 4)) + 11 - firstSelectableYear }, (_, index) => firstSelectableYear + index);
  const presets = salesReportPresets(view, today, firstAvailableDate);
  const matchesRange = (range: SalesReportRange | null) => range?.startDate === startDate && range.endDate === endDate;
  const activePreset = presets.find(preset => preset.id === selectedPresets[view] && matchesRange(preset.range))?.id
    ?? presets.find(preset => matchesRange(preset.range))?.id;

  useEffect(() => {
    const updateToday = () => setToday(current => { const next = todayInKorea(); return current === next ? current : next; });
    const timer = window.setInterval(updateToday, 60_000);
    window.addEventListener("focus", updateToday);
    document.addEventListener("visibilitychange", updateToday);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", updateToday); document.removeEventListener("visibilitychange", updateToday); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/sales-report/range", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json() as { success?: boolean; firstAvailableDate?: string | null; message?: string };
        if (!response.ok || !body.success) throw new Error(body.message ?? "최초 매출일을 불러오지 못했습니다.");
        setFirstAvailableDate(body.firstAvailableDate ?? null); setRangeError("");
      })
      .catch(() => { if (!controller.signal.aborted) setRangeError("최초 매출일을 불러오지 못해 전체 기간 선택을 사용할 수 없습니다."); });
    return () => controller.abort();
  }, []);

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
    const query = new URLSearchParams({ startDate, endDate, page: String(page), sortBy: detailSort.key, sortDirection: detailSort.direction });
    fetch(`/api/admin/sales-report/details?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json() as Details;
        if (!response.ok || !body.success) throw new Error(body.message ?? "판매건 목록을 불러오지 못했습니다.");
        setDetails(body); setDetailError("");
      })
      .catch(cause => { if (!controller.signal.aborted) setDetailError(cause instanceof Error ? cause.message : "판매건 목록을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [view, startDate, endDate, page, validRange, detailSort]);

  const updateRange = (start: string, end: string, target: View = view, preset?: SalesReportPreset["id"]) => {
    setRanges(current => ({ ...current, [target]: { startDate: start, endDate: end } }));
    setSelectedPresets(current => ({ ...current, [target]: preset }));
    setPage(1); setReport(null); setDetails(null);
    setLoading(true); setDetailLoading(true); setError(""); setDetailError("");
  };
  const changeView = (next: View) => {
    if (next === view) return;
    if (!ranges[next]) setSelectedPresets(current => ({ ...current, [next]: next === "detail" ? "today" : "current" }));
    setRanges(current => current[next] ? current : { ...current, [next]: defaultSalesReportRange(next, todayInKorea()) });
    setView(next); setPage(1); setReport(null); setDetails(null);
    setLoading(true); setDetailLoading(true); setError(""); setDetailError("");
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
  const drillDay = (date: string) => { updateRange(date, date, "detail"); setView("detail"); };
  const showSalesDays = view === "yearly" || view === "monthly";
  const visibleColumns = showSalesDays ? summaryColumns : dailyColumns;
  const sortedReportRows = useMemo(() => {
    const rows = sortGridRows(report?.rows ?? [], reportSort, reportSortTypes, (row, key) => {
      if (key === "period") return row.date;
      if (key === "sales") return row.salesAmount;
      if (key === "salesDays") return row.salesDayCount;
      if (key === "dailyAverage") return row.dailySalesAverage;
      if (key === "saleCount") return row.saleCount;
      if (key === "discount") return row.discountAmount;
      if (key === "customerAverage") return row.customerAverage;
      if (key === "tableAverage") return row.tableAverage;
      if (key === "duration") return row.durationMinutes;
      return row.tableGuestAverage;
    });
    // Today is still accumulating. Keep its partial row visible, but after the newest completed day.
    if (view === "daily" && reportSort.key === "period" && reportSort.direction === "desc") {
      return [...rows.filter(row => row.date !== today), ...rows.filter(row => row.date === today)];
    }
    return rows;
  }, [report?.rows, reportSort, view, today]);
  const columnWidths: Record<ReportColumn, number> = {
    ...COLUMN_WIDTHS,
    ...(view === "monthly" ? { period: 130 } : {}),
    ...(view === "daily" ? DAILY_COLUMN_WIDTHS : {}),
  };
  const reportTableWidth = visibleColumns.reduce((total, column) => total + columnWidths[column], 0);
  const detailTableWidth = Object.values(DETAIL_COLUMN_WIDTHS).reduce((total, width) => total + width, 0) + DETAIL_COLUMN_GAP;
  const sortReport = (key: SortColumn) => setReportSort(current => nextGridSort(current, key, key === "period" || key === "sales" || reportSortTypes[key] === "number" ? "desc" : "asc"));
  const sortDetails = (key: DetailSortColumn) => {
    setPage(1); setDetails(null); setDetailLoading(true);
    setDetailSort(current => nextGridSort(current, key, key === "occurredAt" || key === "amount" ? "desc" : "asc"));
  };
  const totals = report?.totals;
  const summary = [
    ["총매출", totals ? `${amount(totals.salesAmount)}원 (${amount(totals.saleCount)}건)` : "-"],
    ["일평균매출", totals?.dailySalesAverage == null || totals.dailySaleCountAverage == null ? "-" :
      `${amount(totals.dailySalesAverage)}원 (${totals.dailySaleCountAverage.toFixed(1)}건)`],
    ["총포장매출", totals?.takeoutAmount == null || totals.takeoutCount == null ? "-" :
      `${amount(totals.takeoutAmount)}원 / ${amount(totals.takeoutCount)}건`],
    ["총할인", totals ? `${amount(totals.discountAmount)}원 (${totals.discountCount == null ? "-" : `${amount(totals.discountCount)}건`})` : "-"],
    ["객단가", totals?.customerAverage == null ? "-" : `${amount(totals.customerAverage)}원`],
    ["테이블단가", totals?.tableAverage == null ? "-" : `${amount(totals.tableAverage)}원`],
    ["평균 이용시간", totals?.durationMinutes == null ? "-" : `${amount(totals.durationMinutes)}분`],
    ["평균 테이블인원", totals?.tableGuestAverage == null ? "-" : `${totals.tableGuestAverage.toFixed(1)}명`],
  ];

  return <div className={admin.content}>
    <div className={styles.heading}><div className={styles.headingTitle}><h1>매출조회</h1><p className={admin.pageDescription}>기간별 매출과 판매 현황을 조회합니다.</p></div>
      <div aria-label="매출조회 단위" className={styles.tabs} role="tablist">
        {([['yearly', '년별'], ['monthly', '월별'], ['daily', '일별'], ['detail', '상세']] as const).map(([key, label]) =>
          <button aria-selected={view === key} className={`${styles.tab} ${view === key ? styles.tabActive : ""}`} key={key} onClick={() => changeView(key)} role="tab" type="button">{label}</button>)}
      </div></div>
    <section className={styles.period} aria-label="조회기간"><strong>조회기간</strong>
      {view === "yearly" ? <div className={styles.periodInputs}><label><select aria-label="시작 연도" onChange={event => updateRange(`${event.target.value}-01-01`, endDate)} value={startDate.slice(0, 4)}>{yearOptions.map(year => <option key={year} value={year}>{year}년</option>)}</select></label><span>~</span><label><select aria-label="종료 연도" onChange={event => updateRange(startDate, `${event.target.value}-12-31`)} value={endDate.slice(0, 4)}>{yearOptions.map(year => <option key={year} value={year}>{year}년</option>)}</select></label></div>
        : view === "monthly" ? <div className={styles.periodInputs}><label><input aria-label="시작 년월" onChange={event => { if (event.target.value) updateRange(`${event.target.value}-01`, endDate); }} type="month" value={startDate.slice(0, 7)} /></label><span>~</span><label><input aria-label="종료 년월" onChange={event => { if (event.target.value) updateRange(startDate, lastOfMonth(event.target.value)); }} type="month" value={endDate.slice(0, 7)} /></label></div>
          : <div className={styles.periodInputs}><label><input aria-label="시작일" onChange={event => updateRange(event.target.value, endDate)} type="date" value={startDate} /></label><span>~</span><label><input aria-label="종료일" onChange={event => updateRange(startDate, event.target.value)} type="date" value={endDate} /></label></div>}
      <div aria-label="빠른 기간 선택" className={styles.periodQuick}>{presets.map(preset => <button
        aria-pressed={activePreset === preset.id} className={`${styles.periodQuickButton} ${activePreset === preset.id ? styles.periodQuickButtonActive : ""}`}
        disabled={!preset.range} key={preset.id} onClick={() => { if (preset.range) updateRange(preset.range.startDate, preset.range.endDate, view, preset.id); }} type="button"
      >{preset.label}</button>)}</div>
    </section>
    {!validRange && <p className={styles.error} role="alert">시작일과 종료일을 확인해 주세요.</p>}
    {rangeError && <p className={styles.error} role="alert">{rangeError}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <section aria-label="기간 집계" className={`${styles.summary} ${styles.summaryWithCounts}`}>{summary.map(([label, value]) => <div className={styles.summaryItem} key={label}><span>{label}</span><strong>{loading ? "-" : value}</strong></div>)}</section>
    {totals && (totals.takeoutAmount === null || totals.discountCount === null) &&
      <p className={styles.note}>구 POS 자료나 결제 배분 정보에 없는 항목은 -로 표시합니다.</p>}
    {view === "detail" ? <>
      <p className={styles.note}>구 POS는 일별 집계만 보관되어 개별 판매건을 표시할 수 없습니다. 아래 목록은 TDK-POS 판매건입니다.</p>
      {detailError && <p className={styles.error} role="alert">{detailError}</p>}
      <div className={styles.tableScroll}><table className={`${styles.table} ${styles.detailTable}`} style={{ minWidth: detailTableWidth }}>
        <colgroup><col style={{ width: DETAIL_COLUMN_WIDTHS.occurredAt }} /><col style={{ width: DETAIL_COLUMN_WIDTHS.tableLabel }} /><col style={{ width: DETAIL_COLUMN_WIDTHS.amount }} /><col style={{ width: DETAIL_COLUMN_GAP }} /><col style={{ width: DETAIL_COLUMN_WIDTHS.paymentMethods }} /><col style={{ width: DETAIL_COLUMN_WIDTHS.status }} /><col /></colgroup>
        <thead><tr>
          <SortableHeader active={detailSort.key === "occurredAt"} className={styles.dateCell} direction={detailSort.direction} onClick={() => sortDetails("occurredAt")}>일시</SortableHeader>
          <SortableHeader active={detailSort.key === "tableLabel"} className={styles.dateCell} direction={detailSort.direction} onClick={() => sortDetails("tableLabel")}>테이블/구분</SortableHeader>
          <SortableHeader active={detailSort.key === "amount"} direction={detailSort.direction} onClick={() => sortDetails("amount")}>금액</SortableHeader>
          <th className={styles.detailGapCell}></th>
          <SortableHeader active={detailSort.key === "paymentMethods"} className={styles.dateCell} direction={detailSort.direction} onClick={() => sortDetails("paymentMethods")}>결제수단</SortableHeader>
          <SortableHeader active={detailSort.key === "status"} className={styles.dateCell} direction={detailSort.direction} onClick={() => sortDetails("status")}>상태</SortableHeader>
          <th className={styles.trailingSpaceHeader}></th>
        </tr></thead>
        <tbody>{details?.rows.map(row => <tr className={styles.clickable} key={row.checkoutId} onClick={() => void openDetail(row.checkoutId)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openDetail(row.checkoutId); } }} role="button" tabIndex={0}><td className={styles.dateCell}>{row.occurredAt.slice(0, 16).replace("T", " ")}</td><td className={styles.dateCell}>{row.tableLabel}</td><td className={styles.mainAmount}>{amount(row.salesAmount)}</td><td className={styles.detailGapCell}></td><td className={styles.dateCell}>{row.paymentMethods}</td><td className={styles.dateCell}>{statusName[row.status]}</td><td className={styles.trailingSpaceCell}></td></tr>)}</tbody></table>
        {detailLoading && <p className={styles.empty}>불러오는 중...</p>}
        {!detailLoading && !details?.rows.length && <p className={styles.empty}>표시할 TDK-POS 판매건이 없습니다.</p>}
      </div>
      {details && details.totalCount > details.pageSize && <div className={styles.pagination}><button disabled={page <= 1 || detailLoading} onClick={() => { setPage(value => value - 1); setDetails(null); setDetailLoading(true); }} type="button">이전</button><span>{page} / {Math.ceil(details.totalCount / details.pageSize)}</span><button disabled={page * details.pageSize >= details.totalCount || detailLoading} onClick={() => { setPage(value => value + 1); setDetails(null); setDetailLoading(true); }} type="button">다음</button></div>}
    </> : <div className={styles.tableScroll}><table className={`${styles.table} ${styles.reportTable}`} style={{ minWidth: reportTableWidth }}>
      <colgroup>{visibleColumns.map(column => <col key={column} style={{ width: columnWidths[column] }} />)}<col /></colgroup>
      <thead><tr>
        <SortableHeader active={reportSort.key === "period"} className={styles.dateCell} direction={reportSort.direction} onClick={() => sortReport("period")}>{view === "yearly" ? "연도" : view === "monthly" ? "월" : "날짜"}</SortableHeader>
        <SortableHeader active={reportSort.key === "sales"} direction={reportSort.direction} onClick={() => sortReport("sales")}>매출</SortableHeader>
        {showSalesDays && <><SortableHeader active={reportSort.key === "salesDays"} direction={reportSort.direction} onClick={() => sortReport("salesDays")}>영업일수</SortableHeader><SortableHeader active={reportSort.key === "dailyAverage"} direction={reportSort.direction} onClick={() => sortReport("dailyAverage")}>일매출평균</SortableHeader></>}
        <SortableHeader active={reportSort.key === "saleCount"} direction={reportSort.direction} onClick={() => sortReport("saleCount")}>판매건수</SortableHeader>
        <SortableHeader active={reportSort.key === "discount"} direction={reportSort.direction} onClick={() => sortReport("discount")}>할인</SortableHeader>
        <SortableHeader active={reportSort.key === "customerAverage"} direction={reportSort.direction} onClick={() => sortReport("customerAverage")}>객단가</SortableHeader>
        <SortableHeader active={reportSort.key === "tableAverage"} direction={reportSort.direction} onClick={() => sortReport("tableAverage")}>테이블단가</SortableHeader>
        <SortableHeader active={reportSort.key === "duration"} direction={reportSort.direction} onClick={() => sortReport("duration")}>평균 이용시간</SortableHeader>
        <SortableHeader active={reportSort.key === "guests"} direction={reportSort.direction} onClick={() => sortReport("guests")}>평균 인원</SortableHeader>
        <th className={styles.trailingSpaceHeader}></th>
      </tr></thead>
      <tbody>{sortedReportRows.map(row => <tr className={view === "daily" ? styles.clickable : ""} key={row.date} onClick={view === "daily" ? () => drillDay(row.date) : undefined} onKeyDown={view === "daily" ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); drillDay(row.date); } } : undefined} role={view === "daily" ? "button" : undefined} tabIndex={view === "daily" ? 0 : undefined}><th className={styles.dateCell}>{view === "daily" ? dailyDateLabel(row.date) : row.label}</th><td className={styles.mainAmount}>{amount(row.salesAmount)}</td>{showSalesDays && <><td>{amount(row.salesDayCount)}일</td><td>{row.dailySalesAverage == null ? "-" : `${amount(row.dailySalesAverage)}원`}</td></>}<td>{amount(row.saleCount)}</td><td>{amount(row.discountAmount)}</td><td>{amount(row.customerAverage)}</td><td>{amount(row.tableAverage)}</td><td>{amount(row.durationMinutes)}</td><td>{row.tableGuestAverage == null ? "-" : row.tableGuestAverage.toFixed(1)}</td><td className={styles.trailingSpaceCell}></td></tr>)}</tbody>
      {totals && <tfoot><tr><th className={styles.dateCell}>합계</th><td>{amount(totals.salesAmount)}</td>{showSalesDays && <><td>{amount(totals.salesDayCount)}일</td><td>{totals.dailySalesAverage == null ? "-" : `${amount(totals.dailySalesAverage)}원`}</td></>}<td>{amount(totals.saleCount)}</td><td>{amount(totals.discountAmount)}</td><td>{amount(totals.customerAverage)}</td><td>{amount(totals.tableAverage)}</td><td>{amount(totals.durationMinutes)}</td><td>{totals.tableGuestAverage == null ? "-" : totals.tableGuestAverage.toFixed(1)}</td><td className={styles.trailingSpaceCell}></td></tr></tfoot>}
      </table>{loading && <p className={styles.empty}>불러오는 중...</p>}</div>}
    {sale && <SaleDetailDialog close={() => setSale(null)} sale={sale} />}
  </div>;
}
