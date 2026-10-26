"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import SortableHeader from "@/app/admin/SortableHeader";
import { nextGridSort, sortGridRows, type GridSortState } from "@/lib/admin-grid-sort";
import admin from "../../admin.module.css";
import reportStyles from "../sales-report/sales-report.module.css";
import styles from "./item-sales.module.css";

type Item = { menuId: number; itemName: string; qty: number; salesAmount: number };
type Day = { businessDate: string; qty: number; salesAmount: number };
type Report = { success: boolean; rows: Item[]; salesDayCount: number; message?: string };
type Detail = { success: boolean; days: Day[]; message?: string };
type Sort = "quantity" | "sales" | "name" | "share" | "daily";
type DetailSort = "date" | "quantity" | "sales";
const itemSortTypes = { quantity: "number", sales: "number", name: "text", share: "number", daily: "number" } as const;
const daySortTypes = { date: "date", quantity: "number", sales: "number" } as const;

const todayInKorea = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const money = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
const count = (value: number) => `${value.toLocaleString("ko-KR")}개`;
const average = (value: number, days: number) => days ? `${(value / days).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}개` : "-";

export default function ItemSalesClient() {
  const today = todayInKorea();
  const [startDate, setStartDate] = useState(todayInKorea);
  const [endDate, setEndDate] = useState(todayInKorea);
  const [sort, setSort] = useState<GridSortState<Sort>>({ key: "sales", direction: "desc" });
  const [detailSort, setDetailSort] = useState<GridSortState<DetailSort>>({ key: "date", direction: "desc" });
  const [report, setReport] = useState<Report | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const validRange = validDate(startDate) && validDate(endDate) && startDate <= endDate &&
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 <= 3_660;

  useEffect(() => {
    if (!validRange) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ startDate, endDate });
    fetch(`/api/admin/item-sales?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json() as Report;
        if (!response.ok || !body.success) throw new Error(body.message ?? "품목별 매출을 불러오지 못했습니다.");
        setReport(body); setError("");
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "품목별 매출을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [startDate, endDate, validRange]);

  useEffect(() => {
    if (!selected) return;
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    const controller = new AbortController();
    const query = new URLSearchParams({ startDate, endDate, menuId: String(selected.menuId), itemName: selected.itemName });
    fetch(`/api/admin/item-sales?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json() as Detail;
        if (!response.ok || !body.success) throw new Error(body.message ?? "날짜별 판매내역을 불러오지 못했습니다.");
        setDetail(body); setDetailError("");
      })
      .catch(cause => { if (!controller.signal.aborted) setDetailError(cause instanceof Error ? cause.message : "날짜별 판매내역을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => { controller.abort(); if (element?.open) element.close(); };
  }, [selected, startDate, endDate]);

  const rows = useMemo(() => sortGridRows(report?.rows ?? [], sort, itemSortTypes, (item, key) =>
    key === "name" ? item.itemName : key === "quantity" || key === "daily" ? item.qty : item.salesAmount,
  ), [report?.rows, sort]);
  const sortedDays = useMemo(() => sortGridRows(detail?.days ?? [], detailSort, daySortTypes, (day, key) =>
    key === "date" ? day.businessDate : key === "quantity" ? day.qty : day.salesAmount,
  ), [detail?.days, detailSort]);
  const totalQty = report?.rows.reduce((sum, item) => sum + item.qty, 0) ?? 0;
  const totalSales = report?.rows.reduce((sum, item) => sum + item.salesAmount, 0) ?? 0;
  const salesDayCount = report?.salesDayCount ?? 0;
  const summary = [
    ["총 품목매출", report ? money(totalSales) : "-"], ["총 판매수량", report ? count(totalQty) : "-"],
    ["판매품목수", report ? count(report.rows.length) : "-"], ["일평균 판매수량", report ? average(totalQty, salesDayCount) : "-"],
  ];
  const quickRanges = [
    { id: "year", label: `${today.slice(0, 4)}년`, startDate: `${today.slice(0, 4)}-01-01`, endDate: today },
    { id: "recent90", label: "최근 90일", startDate: shiftDays(today, -89), endDate: today },
    { id: "recent30", label: "최근 30일", startDate: shiftDays(today, -29), endDate: today },
    { id: "recent7", label: "최근 7일", startDate: shiftDays(today, -6), endDate: today },
    { id: "today", label: "당일", startDate: today, endDate: today },
  ] as const;
  const activeQuickRange = quickRanges.find(range => range.startDate === startDate && range.endDate === endDate)?.id;
  const changeRange = (start: string, end: string) => {
    setStartDate(start); setEndDate(end); setReport(null); setSelected(null);
    setLoading(validDate(start) && validDate(end) && start <= end &&
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 <= 3_660);
    setError("");
  };
  const openDetail = (item: Item) => {
    setDetail(null); setDetailError(""); setDetailLoading(true); setSelected(item);
  };
  const changeSort = (key: Sort) => setSort(current => nextGridSort(current, key, key === "name" ? "asc" : "desc"));
  const changeDetailSort = (key: DetailSort) => setDetailSort(current => nextGridSort(current, key, "desc"));

  return <div className={admin.content}>
    <div className={reportStyles.heading}><div className={reportStyles.headingTitle}>
      <h1>품목별 매출</h1><p className={admin.pageDescription}>기간별 품목 판매량과 매출 현황을 조회합니다.</p>
    </div></div>
    <section className={reportStyles.period} aria-label="조회기간"><strong>조회기간</strong>
      <div className={reportStyles.periodInputs}>
        <label><input aria-label="시작일" type="date" value={startDate} onChange={event => changeRange(event.target.value, endDate)} /></label>
        <span>~</span>
        <label><input aria-label="종료일" type="date" value={endDate} onChange={event => changeRange(startDate, event.target.value)} /></label>
      </div>
      <div aria-label="빠른 기간 선택" className={reportStyles.periodQuick}>
        {quickRanges.map(range => <button
          aria-pressed={activeQuickRange === range.id}
          className={`${reportStyles.periodQuickButton} ${activeQuickRange === range.id ? reportStyles.periodQuickButtonActive : ""}`}
          key={range.id}
          onClick={() => changeRange(range.startDate, range.endDate)}
          type="button"
        >{range.label}</button>)}
      </div>
    </section>
    {!validRange && <p className={reportStyles.error} role="alert">조회기간을 확인해 주세요. 최대 10년까지 조회할 수 있습니다.</p>}
    {error && <p className={reportStyles.error} role="alert">{error}</p>}
    <section aria-label="품목별 집계" className={reportStyles.summary}>
      {summary.map(([label, value]) => <div className={reportStyles.summaryItem} key={label}><span>{label}</span><strong>{loading ? "-" : value}</strong></div>)}
    </section>
    <div className={styles.listHeading}><h2>품목별 판매내역</h2><div aria-label="정렬 방식" className={styles.sortButtons}>
      {([['quantity', '수량순'], ['sales', '매출순'], ['name', '품목명순']] as const).map(([key, label]) =>
        <button aria-pressed={sort.key === key} className={sort.key === key ? styles.sortActive : ""} key={key} onClick={() => changeSort(key)} type="button">{label}</button>)}
    </div></div>
    <div className={styles.tableScroll}><table className={styles.table}><thead><tr>
      <th>순위</th>
      <SortableHeader active={sort.key === "name"} className={styles.nameCell} direction={sort.direction} onClick={() => changeSort("name")}>품목명</SortableHeader>
      <SortableHeader active={sort.key === "quantity"} direction={sort.direction} onClick={() => changeSort("quantity")}>판매수량</SortableHeader>
      <SortableHeader active={sort.key === "sales"} direction={sort.direction} onClick={() => changeSort("sales")}>매출액</SortableHeader>
      <SortableHeader active={sort.key === "share"} direction={sort.direction} onClick={() => changeSort("share")}>판매비중</SortableHeader>
      <SortableHeader active={sort.key === "daily"} direction={sort.direction} onClick={() => changeSort("daily")}>일평균</SortableHeader>
    </tr></thead><tbody>
      {rows.map((item, index) => <tr className={styles.itemRow} key={`${item.menuId}:${item.itemName}`} onClick={() => openDetail(item)}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetail(item); } }} role="button" tabIndex={0}>
        <td>{index + 1}</td><th scope="row" className={styles.nameCell}>{item.itemName}</th><td>{count(item.qty)}</td><td className={styles.amountCell}>{money(item.salesAmount)}</td>
        <td>{totalSales ? `${(item.salesAmount / totalSales * 100).toFixed(1)}%` : "-"}</td><td>{average(item.qty, salesDayCount)}</td>
      </tr>)}
    </tbody></table>
      {loading && <p className={styles.empty}>불러오는 중...</p>}
      {!loading && validRange && !error && !rows.length && <p className={styles.empty}>조회기간에 판매된 품목이 없습니다.</p>}
    </div>
    <p className={reportStyles.note}>품목별 매출은 TDK-POS 품목 상세 데이터만 집계합니다. 주문 전체 할인은 품목에 배분하지 않았으며, 판매가 발생한 날짜만 일평균에 포함합니다.</p>
    <dialog aria-labelledby="item-sales-detail-title" className={styles.dialog} onClose={() => setSelected(null)} ref={dialog}>
      {selected && <><div className={styles.dialogHeading}><h2 id="item-sales-detail-title">{selected.itemName}</h2><button aria-label="닫기" onClick={() => dialog.current?.close()} type="button">×</button></div>
        <div className={styles.detailSummary}><span>조회기간</span><strong>{startDate} ~ {endDate}</strong><span>총 판매수량</span><strong>{count(selected.qty)}</strong>
          <span>총 품목매출</span><strong>{money(selected.salesAmount)}</strong><span>일평균 판매량</span><strong>{average(selected.qty, salesDayCount)}</strong></div>
        {detailError && <p className={reportStyles.error} role="alert">{detailError}</p>}
        <div className={styles.detailScroll}><table className={styles.table}><thead><tr>
          <SortableHeader active={detailSort.key === "date"} className={styles.nameCell} direction={detailSort.direction} onClick={() => changeDetailSort("date")}>날짜</SortableHeader>
          <SortableHeader active={detailSort.key === "quantity"} direction={detailSort.direction} onClick={() => changeDetailSort("quantity")}>판매수량</SortableHeader>
          <SortableHeader active={detailSort.key === "sales"} direction={detailSort.direction} onClick={() => changeDetailSort("sales")}>매출액</SortableHeader>
          </tr></thead>
          <tbody>{sortedDays.map(day => <tr key={day.businessDate}><th className={styles.nameCell} scope="row">{day.businessDate}</th><td>{count(day.qty)}</td><td>{money(day.salesAmount)}</td></tr>)}</tbody></table>
          {detailLoading && <p className={styles.empty}>불러오는 중...</p>}
          {!detailLoading && !detail?.days.length && !detailError && <p className={styles.empty}>판매내역이 없습니다.</p>}</div>
        <p className={reportStyles.note}>판매가 발생한 날짜만 표시합니다.</p>
      </>}
    </dialog>
  </div>;
}
