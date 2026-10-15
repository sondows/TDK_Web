"use client";

import { useEffect, useState } from "react";

type Row = {
  business_date: string; sale_count: number; gross_sales: number; discount_amount: number; net_sales: number;
  card_amount: number; cash_amount: number; bank_transfer_amount: number; other_amount: number;
  cancelled_count: number; cancelled_amount: number; source: "LEGACY_POS";
};
type Result = { success: boolean; startDate: string | null; endDate: string | null; rows: Row[]; totals: Omit<Row, "business_date" | "source"> | null; message?: string };
const money = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;

export default function LegacySalesClient() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(start?: string, end?: string) {
    setLoading(true);
    setError("");
    try {
      const query = start && end ? `?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}` : "";
      const response = await fetch(`/api/admin/legacy-sales${query}`, { cache: "no-store" });
      const data = await response.json() as Result;
      if (!response.ok || !data.success) throw new Error(data.message ?? "구 POS 집계자료를 불러오지 못했습니다.");
      setResult(data);
      setStartDate(data.startDate ?? "");
      setEndDate(data.endDate ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "조회에 실패했습니다."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let active = true;
    fetch("/api/admin/legacy-sales", { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as Result;
        if (!response.ok || !data.success) throw new Error(data.message ?? "구 POS 집계자료를 불러오지 못했습니다.");
        if (active) { setResult(data); setStartDate(data.startDate ?? ""); setEndDate(data.endDate ?? ""); }
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "조회에 실패했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return <div className="space-y-6 p-6">
    <div><h1 className="text-2xl font-extrabold text-slate-900">구 POS 일별 매출</h1><p className="mt-1 text-sm text-slate-600">구 POS 집계자료 · 현재 TDK-POS 판매와 별도 표시</p></div>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (startDate && endDate) void load(startDate, endDate); }}>
      <label className="text-sm font-semibold text-slate-700">시작일<input className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" onChange={event => setStartDate(event.target.value)} required type="date" value={startDate} /></label>
      <label className="text-sm font-semibold text-slate-700">종료일<input className="mt-1 block rounded-lg border border-slate-300 px-3 py-2" onChange={event => setEndDate(event.target.value)} required type="date" value={endDate} /></label>
      <button className="rounded-lg bg-blue-700 px-5 py-2 font-semibold text-white" disabled={loading} type="submit">조회</button>
    </form>
    {error && <p className="text-red-700" role="alert">{error}</p>}
    {result?.totals && <section aria-label="구 POS 기간 합계" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {([
        ["순매출", money(result.totals.net_sales)], ["정상 판매", `${result.totals.sale_count.toLocaleString("ko-KR")}건`],
        ["주문금액", money(result.totals.gross_sales)], ["할인", money(result.totals.discount_amount)],
        ["카드", money(result.totals.card_amount)], ["현금", money(result.totals.cash_amount)],
        ["계좌이체", money(result.totals.bank_transfer_amount)], ["기타", money(result.totals.other_amount)],
        ["삭제 표시", `${result.totals.cancelled_count.toLocaleString("ko-KR")}건 · ${money(result.totals.cancelled_amount)}`],
      ] as const).map(([label, value]) => <div className="rounded-xl border border-slate-200 bg-white p-4" key={label}><span className="block text-sm text-slate-600">{label}</span><strong className="mt-1 block text-lg text-slate-900">{value}</strong></div>)}
    </section>}
    <p className="text-sm text-slate-600">결제수단 합계와 순매출은 원본 차이로 일치하지 않을 수 있습니다. 이 화면은 일별 집계만 제공하며 판매건 상세는 없습니다.</p>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="min-w-[1120px] w-full text-right text-sm">
      <thead className="bg-slate-50 text-slate-700"><tr><th className="px-3 py-3 text-left">영업일</th><th className="px-3 py-3">건수</th><th className="px-3 py-3">주문금액</th><th className="px-3 py-3">할인</th><th className="px-3 py-3">순매출</th><th className="px-3 py-3">카드</th><th className="px-3 py-3">현금</th><th className="px-3 py-3">계좌이체</th><th className="px-3 py-3">기타</th><th className="px-3 py-3">삭제</th></tr></thead>
      <tbody>{result?.rows.map(row => <tr className="border-t border-slate-100" key={row.business_date}><th className="px-3 py-3 text-left font-semibold whitespace-nowrap">{row.business_date}<span className="ml-2 text-xs text-slate-500">구 POS</span></th><td className="px-3 py-3">{row.sale_count}</td><td className="px-3 py-3">{money(row.gross_sales)}</td><td className="px-3 py-3">{money(row.discount_amount)}</td><td className="px-3 py-3 font-bold">{money(row.net_sales)}</td><td className="px-3 py-3">{money(row.card_amount)}</td><td className="px-3 py-3">{money(row.cash_amount)}</td><td className="px-3 py-3">{money(row.bank_transfer_amount)}</td><td className="px-3 py-3">{money(row.other_amount)}</td><td className="px-3 py-3">{row.cancelled_count}건</td></tr>) ?? null}</tbody>
    </table>{!loading && !result?.rows.length && <p className="p-6 text-center text-slate-500">선택한 기간의 구 POS 집계자료가 없습니다.</p>}</div>
  </div>;
}
