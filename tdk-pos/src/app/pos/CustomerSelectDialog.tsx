"use client";

import { useEffect, useState } from "react";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import PosSubHeader from "./PosSubHeader";

export type SelectedCustomer = { customerId: number; name: string };
type Customer = { customerId: number; name: string; contactName: string | null; phone: string | null };

const formatPhone = (value: string | null) => {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : value;
};

export default function CustomerSelectDialog({ selected, onSelect, onClose }: {
  selected: SelectedCustomer | null;
  onSelect: (customer: SelectedCustomer | null) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [allRows, setAllRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [noResults, setNoResults] = useState(false);

  const load = async (query = "") => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/pos/customers${query ? `?search=${encodeURIComponent(query)}` : ""}`, { cache: "no-store" });
      const result = await response.json() as { success?: boolean; customers?: Customer[]; message?: string };
      if (!response.ok || !result.success || !Array.isArray(result.customers)) throw new Error(result.message ?? "고객 목록을 불러오지 못했습니다.");
      return result.customers;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "고객 목록을 불러오지 못했습니다.");
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void load().then(result => { if (result) { setRows(result); setAllRows(result); } }); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleKey = (key: string) => {
    if (key === "C") {
      setInput("");
      setRows(allRows);
      setNoResults(false);
      return;
    }
    setInput(value => key === "BS" ? value.slice(0, -1) : `${value}${key}`.replace(/\D/g, "").slice(0, 11));
  };
  const displayInput = input || "0";
  const searchPhone = async () => {
    if (!input) return;
    const result = await load(input);
    if (result?.length) { setRows(result); setInput(""); setExpanded(false); setNoResults(false); }
    else if (result) setNoResults(true);
  };
  const closeSearch = () => { setInput(""); setExpanded(false); setNoResults(false); };

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4">
    <section aria-modal="true" className={`flex h-[min(560px,calc(100dvh-2rem))] w-full ${expanded ? "max-w-[757px]" : "max-w-[420px]"} flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} role="dialog">
      <PosSubHeader backLabel="고객 선택 닫기" backIconSize={19} backVisualSize={39} onBack={onClose} title="고객 선택" trailingClassName={expanded ? "w-[337px] justify-end" : ""} trailing={<button className={`h-[52px] shrink-0 rounded-none border-0 bg-transparent text-right text-2xl font-extrabold text-white/90 shadow-none transition-colors hover:text-white active:text-white focus-visible:outline-none ${expanded ? "w-full pr-0" : "min-w-[160px] px-0"}`} onClick={() => expanded ? closeSearch() : setExpanded(true)} type="button"><span className="inline-flex max-w-full items-center justify-end gap-1"><span>{expanded ? "검색 종료" : "전화검색"}</span><span aria-hidden="true" className="shrink-0 text-[22px] leading-none">⋮</span></span></button>} />
      <div className={`grid min-h-0 flex-1 ${expanded ? "grid-cols-[minmax(0,420px)_337px]" : "grid-cols-1"}`}>
        <div aria-label="고객 목록" className="min-h-0 overflow-y-auto p-5" role="listbox">
          {loading ? <p>불러오는 중...</p> : error ? <p className="text-red-600" role="alert">{error}</p> : rows.map(customer => <button
            aria-selected={selected?.customerId === customer.customerId}
            className={`mb-2 flex min-h-[60px] w-[80%] items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left ${selected?.customerId === customer.customerId ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}
            key={customer.customerId}
            onClick={() => onSelect(selected?.customerId === customer.customerId ? null : { customerId: customer.customerId, name: customer.name })}
            role="option"
            type="button"
          >
            <span className="min-w-0 flex-1 truncate text-xl font-bold">{customer.name}</span>
            {customer.phone && <span className="shrink-0 text-base font-medium text-slate-600">{formatPhone(customer.phone)}</span>}
          </button>)}
        </div>
        {expanded && <div className="flex flex-col border-l bg-slate-50 p-4">
          <NumericInputKeypad disabled={noResults} keys={["1", "2", "3", "4", "5", "6", "7", "8", "9", "BS", "0", "C"]} onKey={handleKey} value={displayInput} />
          <button className="mt-3 min-h-16 rounded-xl bg-blue-600 text-xl font-bold text-white disabled:bg-slate-300" disabled={!input || loading || noResults} onClick={() => void searchPhone()} type="button">검색</button>
        </div>}
      </div>
      {noResults && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
        <section aria-modal="true" className="rounded-2xl bg-white p-7 text-center" role="alertdialog">
          <h2 className="text-2xl font-bold">검색 결과 없음</h2>
          <p className="my-5 text-xl">일치하는 고객이 없습니다.</p>
          <button autoFocus className="min-h-14 w-40 rounded-xl bg-blue-600 text-xl font-bold text-white" onClick={() => { setNoResults(false); setInput(""); }} type="button">확인</button>
        </section>
      </div>}
    </section>
  </div>;
}
