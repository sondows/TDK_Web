"use client";

import { useEffect, useState } from "react";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import PosSubHeader from "./PosSubHeader";
import { POS_HEADER_ACTION_CLASS_NAME } from "./pos-header-action";

export type SelectedCustomer = {
  customerId: number;
  name: string;
  isPaymentManaged: boolean;
  tradeBalance: number;
  usesFixedCoupon: boolean;
  fixedCouponAmount: number | null;
  fixedCouponBalancePolicy: "CASH_CHANGE" | "FORFEIT";
  fixedCouponCashChangeEnabled: number;
  fixedCouponCashChangeMinPercent: number | null;
};
type Customer = SelectedCustomer & { contactName: string | null; phone: string | null; lastTransactionAt: string | null };
type SortMode = "recent" | "name" | "phone" | "balance";
type SortDirection = "asc" | "desc";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [tradeManagedOnly, setTradeManagedOnly] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/pos/customers?includeAll=1&includeRecent=1&includeBalance=1", { cache: "no-store" });
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
    const timer = window.setTimeout(() => { void load().then(result => { if (result) setRows(result); }); }, 0);
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
      return;
    }
    setInput(value => key === "BS" ? value.slice(0, -1) : `${value}${key}`.replace(/\D/g, "").slice(0, 11));
  };
  const displayInput = input || "0";
  const closeSearch = () => { setInput(""); setExpanded(false); };
  const selectSort = (mode: SortMode) => {
    if (sortMode === mode) setSortDirection(direction => direction === "asc" ? "desc" : "asc");
    else { setSortMode(mode); setSortDirection(mode === "recent" || mode === "balance" ? "desc" : "asc"); }
  };
  const visibleRows = rows.filter(customer => (!tradeManagedOnly || customer.isPaymentManaged) && (!input || customer.phone?.replace(/\D/g, "").includes(input)));
  if (sortMode === "recent") visibleRows.sort((left, right) => {
    if (!left.lastTransactionAt || !right.lastTransactionAt) return Number(Boolean(right.lastTransactionAt)) - Number(Boolean(left.lastTransactionAt));
    const dateOrder = left.lastTransactionAt.localeCompare(right.lastTransactionAt);
    return (sortDirection === "asc" ? dateOrder : -dateOrder) || left.name.localeCompare(right.name, "ko") || left.customerId - right.customerId;
  });
  if (sortMode === "name") visibleRows.sort((left, right) => (sortDirection === "asc" ? 1 : -1) * left.name.localeCompare(right.name, "ko") || left.customerId - right.customerId);
  if (sortMode === "phone") visibleRows.sort((left, right) => {
    const leftPhone = left.phone?.replace(/\D/g, "") ?? "";
    const rightPhone = right.phone?.replace(/\D/g, "") ?? "";
    return (leftPhone ? 0 : 1) - (rightPhone ? 0 : 1) || (sortDirection === "asc" ? 1 : -1) * leftPhone.localeCompare(rightPhone, "ko", { numeric: true }) || left.customerId - right.customerId;
  });
  if (sortMode === "balance") visibleRows.sort((left, right) => (sortDirection === "asc" ? left.tradeBalance - right.tradeBalance : right.tradeBalance - left.tradeBalance) || left.name.localeCompare(right.name, "ko") || left.customerId - right.customerId);

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 p-4">
    <section aria-modal="true" className={`flex ${expanded ? "h-[min(515px,calc(100dvh-77px))] w-[1027px]" : "h-[min(560px,calc(100dvh-2rem))] w-[690px]"} shrink-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`} role="dialog">
      <PosSubHeader backLabel="고객 선택 닫기" backIconSize={19} backVisualSize={39} onBack={onClose} title="고객 선택" trailing={<button aria-expanded={expanded} className={POS_HEADER_ACTION_CLASS_NAME} onClick={() => expanded ? closeSearch() : setExpanded(true)} type="button">{expanded ? "간단 ‹" : "전화검색 ⋮"}</button>} />
      <div className={`grid min-h-0 flex-1 ${expanded ? "grid-cols-[420px_270px_337px]" : "grid-cols-[420px_270px]"}`}>
        <div aria-label="고객 목록" className="min-h-0 overflow-y-auto p-5" role="listbox">
          {loading ? <p>불러오는 중...</p> : error ? <p className="text-red-600" role="alert">{error}</p> : visibleRows.map(customer => <button
            aria-selected={selected?.customerId === customer.customerId}
            className={`mb-2 flex min-h-[60px] w-[80%] items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left ${selected?.customerId === customer.customerId ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}
            key={customer.customerId}
            onClick={() => onSelect(selected?.customerId === customer.customerId ? null : customer)}
            role="option"
            type="button"
          >
            <span className="min-w-0 flex-1 truncate text-xl font-bold">{customer.name}</span>
            {customer.phone && <span className="shrink-0 text-base font-medium text-slate-600">{formatPhone(customer.phone)}</span>}
          </button>)}
        </div>
        <div className="flex min-h-0 flex-col gap-3 border-l border-slate-200 bg-white p-4">
          <button aria-checked={tradeManagedOnly} className="flex min-h-[52px] items-center justify-between rounded-xl border border-slate-200 bg-white px-4 text-left text-sm font-semibold text-slate-800" onClick={() => setTradeManagedOnly(value => !value)} role="switch" type="button">
            <span>거래관리</span>
            <span aria-hidden="true" className={`relative h-10 w-[76px] rounded-full transition-colors ${tradeManagedOnly ? "bg-blue-600" : "bg-slate-200"}`}>
              <span className={`absolute top-1 left-1 h-8 w-8 rounded-full bg-white shadow-sm transition-transform ${tradeManagedOnly ? "translate-x-9" : "translate-x-0"}`} />
              <span className={`absolute top-0 flex h-full items-center text-xs font-bold ${tradeManagedOnly ? "left-3 text-white" : "right-2 text-slate-600"}`}>{tradeManagedOnly ? "ON" : "OFF"}</span>
            </span>
          </button>
          <div aria-hidden="true" className="flex min-h-0 flex-1 items-center justify-center">
            <span className="text-xl font-extrabold tracking-wider text-blue-700">TDK POS</span>
          </div>
          <div className="flex shrink-0 flex-col gap-3">
            {([['recent', '최근거래'], ['name', '이름'], ['phone', '전화번호'], ['balance', '잔액']] as const).map(([mode, label]) => <button aria-pressed={sortMode === mode} className={`flex min-h-[52px] w-full items-center justify-between rounded-xl border px-4 text-left text-sm font-semibold transition-colors ${sortMode === mode ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} key={mode} onClick={() => selectSort(mode)} type="button"><span>{label}</span>{sortMode === mode && <span aria-hidden="true" className="text-base">{sortDirection === "asc" ? "↑" : "↓"}</span>}</button>)}
          </div>
        </div>
        {expanded && <div className="flex flex-col border-l border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-2 h-6 shrink-0 text-center text-base font-semibold text-slate-700">전화검색</h3>
          <NumericInputKeypad inputLabel="" keys={["1", "2", "3", "4", "5", "6", "7", "8", "9", "BS", "0", "C"]} onKey={handleKey} value={displayInput} />
        </div>}
      </div>
    </section>
  </div>;
}
