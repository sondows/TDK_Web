"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AdminBackLink from "@/app/pos/admin/AdminBackLink";
import admin from "../../admin.module.css";
import reportStyles from "../sales-report/sales-report.module.css";
import styles from "./item-sales.module.css";

type Item = { menuId: number; itemName: string; qty: number; salesAmount: number };
type Day = { businessDate: string; qty: number; salesAmount: number };
type Report = { success: boolean; rows: Item[]; salesDayCount: number; message?: string };
type Detail = { success: boolean; days: Day[]; message?: string };
type Sort = "quantity" | "sales" | "name";

const todayInKorea = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const money = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
const count = (value: number) => `${value.toLocaleString("ko-KR")}개`;
const average = (value: number, days: number) => days ? `${(value / days).toLocaleString("ko-KR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}개` : "-";

export default function ItemSalesClient() {
  const [startDate, setStartDate] = useState(() => `${todayInKorea().slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(todayInKorea);
  const [sort, setSort] = useState<Sort>("quantity");
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

  const rows = useMemo(() => [...(report?.rows ?? [])].sort((a, b) => {
    const primary = sort === "quantity" ? b.qty - a.qty : sort === "sales" ? b.salesAmount - a.salesAmount : a.itemName.localeCompare(b.itemName, "ko");
    return primary || a.itemName.localeCompare(b.itemName, "ko") || a.menuId - b.menuId;
  }), [report, sort]);
  const totalQty = report?.rows.reduce((sum, item) => sum + item.qty, 0) ?? 0;
  const totalSales = report?.rows.reduce((sum, item) => sum + item.salesAmount, 0) ?? 0;
  const salesDayCount = report?.salesDayCount ?? 0;
  const summary = [
    ["총 품목매출", report ? money(totalSales) : "-"], ["총 판매수량", report ? count(totalQty) : "-"],
    ["판매품목수", report ? count(report.rows.length) : "-"], ["일평균 판매수량", report ? average(totalQty, salesDayCount) : "-"],
  ];
  const changeRange = (start: string, end: string) => {
    setStartDate(start); setEndDate(end); setReport(null); setSelected(null);
    setLoading(validDate(start) && validDate(end) && start <= end &&
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 <= 3_660);
    setError("");
  };
  const openDetail = (item: Item) => {
    setDetail(null); setDetailError(""); setDetailLoading(true); setSelected(item);
  };

  return <div className={admin.content}>
    <div className={reportStyles.heading}><div className={reportStyles.headingTitle}>
      <AdminBackLink ariaLabel="관리센터로 돌아가기" size={40} iconSize={20} /><h1>품목별 매출</h1>
    </div></div>
    <section className={reportStyles.period} aria-label="조회기간"><strong>조회기간</strong>
      <div className={reportStyles.periodInputs}>
        <label><input aria-label="시작일" type="date" value={startDate} onChange={event => changeRange(event.target.value, endDate)} /></label>
        <span>~</span>
        <label><input aria-label="종료일" type="date" value={endDate} onChange={event => changeRange(startDate, event.target.value)} /></label>
      </div>
    </section>
    {!validRange && <p className={reportStyles.error} role="alert">조회기간을 확인해 주세요. 최대 10년까지 조회할 수 있습니다.</p>}
    {error && <p className={reportStyles.error} role="alert">{error}</p>}
    <section aria-label="품목별 집계" className={reportStyles.summary}>
      {summary.map(([label, value]) => <div className={reportStyles.summaryItem} key={label}><span>{label}</span><strong>{loading ? "-" : value}</strong></div>)}
    </section>
    <div className={styles.listHeading}><h2>품목별 판매내역</h2><div aria-label="정렬 방식" className={styles.sortButtons}>
      {([['quantity', '수량순'], ['sales', '매출순'], ['name', '품목명순']] as const).map(([key, label]) =>
        <button aria-pressed={sort === key} className={sort === key ? styles.sortActive : ""} key={key} onClick={() => setSort(key)} type="button">{label}</button>)}
    </div></div>
    <div className={styles.tableScroll}><table className={styles.table}><thead><tr>
      <th>순위</th><th className={styles.nameCell}>품목명</th><th>판매수량</th><th>매출액</th><th>판매비중</th><th>일평균</th>
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
        <div className={styles.detailScroll}><table className={styles.table}><thead><tr><th className={styles.nameCell}>날짜</th><th>판매수량</th><th>매출액</th></tr></thead>
          <tbody>{detail?.days.map(day => <tr key={day.businessDate}><th className={styles.nameCell} scope="row">{day.businessDate}</th><td>{count(day.qty)}</td><td>{money(day.salesAmount)}</td></tr>)}</tbody></table>
          {detailLoading && <p className={styles.empty}>불러오는 중...</p>}
          {!detailLoading && !detail?.days.length && !detailError && <p className={styles.empty}>판매내역이 없습니다.</p>}</div>
        <p className={reportStyles.note}>판매가 발생한 날짜만 표시합니다.</p>
      </>}
    </dialog>
  </div>;
}
