"use client";

import { useEffect, useState } from "react";
import { CASH_DENOMINATIONS, type CashOpeningFund } from "@/lib/cash-opening-fund";
import reportStyles from "../../../sales-report/sales-report.module.css";
import closingStyles from "../../../business-closings/business-closings.module.css";

type CashEvent = {
  id: string; occurredAt: string; type: "OPENING_CASH" | "CASH_CHECK";
  source: "POS" | "BUSINESS_CLOSE"; amount: number;
  expectedCash: number | null; actualCash: number | null; difference: number | null;
  fund: CashOpeningFund | null;
};
type HistoryResult = { success?: boolean; message?: string; rows?: CashEvent[]; total?: number; page?: number; pageSize?: number };

const todayInKorea = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const amount = (value: number | null) => value === null ? "-" : value.toLocaleString("ko-KR");
const signed = (value: number | null) => value === null ? "-" : value > 0 ? `+${amount(value)}` : amount(value);
const won = (value: number | null) => value === null ? "-" : `${amount(value)}원`;
const occurred = (value: string) => value.replace("T", " ").slice(0, 16);

export default function CashHistoryClient() {
  const [from, setFrom] = useState(() => shiftDays(todayInKorea(), -29));
  const [to, setTo] = useState(todayInKorea);
  const [query, setQuery] = useState(() => ({ from: shiftDays(todayInKorea(), -29), to: todayInKorea(), page: 1 }));
  const [rows, setRows] = useState<CashEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<CashEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams({ from: query.from, to: query.to, page: String(query.page) });
        const response = await fetch(`/api/admin/cash-history?${params}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as HistoryResult;
        if (!response.ok || !result.success) throw new Error(result.message ?? "시재 내역을 불러오지 못했습니다.");
        setRows(result.rows ?? []); setTotal(result.total ?? 0); setPageSize(result.pageSize ?? 20);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setRows([]); setTotal(0);
        setError(cause instanceof Error ? cause.message : "시재 내역을 불러오지 못했습니다.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [query]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const line = (label: string, value: string) => <div className={closingStyles.detailLine}><span>{label}</span><strong>{value}</strong></div>;

  return <section className="mt-8">
    <h2 className="mb-4 border-t border-slate-200 pt-6 text-xl font-bold text-slate-800">시재 내역</h2>
    <form className={reportStyles.period} onSubmit={event => {
      event.preventDefault();
      if (from && to && from <= to) { setSelected(null); setQuery({ from, to, page: 1 }); }
      else setError("조회기간을 확인해 주세요.");
    }}>
      <strong>기간</strong>
      <div className={reportStyles.periodInputs}>
        <label><input aria-label="시재 내역 시작일" onChange={event => setFrom(event.target.value)} required type="date" value={from} /></label>
        <span>~</span>
        <label><input aria-label="시재 내역 종료일" onChange={event => setTo(event.target.value)} required type="date" value={to} /></label>
      </div>
      <button className={closingStyles.searchButton} type="submit">조회</button>
    </form>
    {error && <p className={closingStyles.error} role="alert">{error}</p>}
    {loading ? <p className={closingStyles.message}>시재 내역을 불러오는 중입니다.</p> : error ? null : rows.length === 0
      ? <p className={closingStyles.empty}>시재 내역이 없습니다.</p>
      : <div className={reportStyles.tableScroll}>
        <table className={reportStyles.table}>
          <thead><tr><th className={reportStyles.dateCell}>일시</th><th className={reportStyles.dateCell}>항목</th><th>금액</th><th>예상 시재</th><th>실제 시재</th><th>오차</th></tr></thead>
          <tbody>{rows.map(row => <tr className={`${reportStyles.clickable} focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-600`} key={row.id}
            onClick={() => setSelected(row)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(row); } }} tabIndex={0}>
            <td className={reportStyles.dateCell}>{occurred(row.occurredAt)}</td>
            <td className={reportStyles.dateCell}>{row.type === "OPENING_CASH" ? "영업준비금" : "시재확인"}</td>
            <td>{amount(row.amount)}</td><td>{amount(row.expectedCash)}</td><td>{amount(row.actualCash)}</td>
            <td className={row.difference !== null && row.difference < 0 ? "text-red-600" : row.difference !== null && row.difference > 0 ? "text-blue-700" : ""}>{signed(row.difference)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    {!loading && !error && total > pageSize && <div className="mt-4 flex items-center justify-center gap-3 text-sm text-slate-600">
      <button className={closingStyles.searchButton} disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })} type="button">이전</button>
      <span>{query.page} / {pages}</span>
      <button className={closingStyles.searchButton} disabled={query.page >= pages} onClick={() => setQuery({ ...query, page: query.page + 1 })} type="button">다음</button>
    </div>}
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setSelected(null)}>
      <section aria-label={selected.type === "OPENING_CASH" ? "영업준비금 상세" : "시재확인 상세"} aria-modal="true" className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl" onClick={event => event.stopPropagation()} role="dialog">
        <div className="flex items-center justify-between gap-4"><h3 className="text-lg font-bold text-slate-800">{selected.type === "OPENING_CASH" ? "영업준비금 상세" : "시재확인 상세"}</h3>
          <button aria-label="상세 닫기" className={closingStyles.searchButton} onClick={() => setSelected(null)} type="button">닫기</button></div>
        <div className="mt-4 border-t border-slate-200 pt-3 text-sm">
          {line("일시", occurred(selected.occurredAt))}
          {selected.type === "CASH_CHECK" && <>{line("발생 경로", selected.source === "BUSINESS_CLOSE" ? "영업마감" : "POS 시재 확인")}
            {line("예상 시재", won(selected.expectedCash))}{line("실제 시재", won(selected.actualCash))}
            {line("오차", selected.difference === null ? "-" : `${signed(selected.difference)}원`)}</>}
          {selected.fund ? <div className="mt-3 border-t border-slate-200 pt-3">
            {CASH_DENOMINATIONS.map(denomination => line(`${amount(denomination)}원`, `${amount(selected.fund!.counts[denomination])}${denomination >= 1000 ? "장" : "개"} · ${amount(denomination * selected.fund!.counts[denomination])}원`))}
            {line("기타", `${amount(selected.fund.otherAmount)}원`)}
          </div> : <p className="mt-3 border-t border-slate-200 pt-3 text-slate-500">이 기록에는 권종별 내역이 저장되지 않았습니다.</p>}
          <div className="mt-3 border-t border-slate-200 pt-3">{line("합계", `${amount(selected.amount)}원`)}</div>
        </div>
      </section>
    </div>}
  </section>;
}
