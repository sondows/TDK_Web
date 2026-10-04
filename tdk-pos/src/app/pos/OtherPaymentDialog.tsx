"use client";

import { useEffect, useRef, useState } from "react";
import VerticalScrollIndicators from "@/components/VerticalScrollIndicators";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import { formatMoney } from "@/lib/format-money";
import { meetsCashChangeThreshold, resolveQuantityOverage } from "@/lib/other-payment-cash-change";
import type { OtherPaymentMethod } from "@/lib/other-payment-types";
import { useVerticalScroll } from "@/hooks/useVerticalScroll";
import PosSubHeader from "./PosSubHeader";

type CustomerPaymentCandidate = {
  customerId: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  tradeBalance: number;
  usesFixedCoupon: boolean;
  fixedCouponAmount: number | null;
  fixedCouponBalancePolicy: "CASH_CHANGE" | "FORFEIT";
  fixedCouponCashChangeEnabled: number;
  fixedCouponCashChangeMinPercent: number | null;
};

export default function OtherPaymentDialog({ remaining, customerRemaining, close, submit, submitCustomer, busy, allowOverpayment }: {
  remaining: number;
  customerRemaining: number;
  close: () => void;
  submit: (methodId: number, inputValue: number, tendered: number, methodName: string, cashChangeEnabled: boolean) => Promise<{ ok: boolean; message?: string }>;
  submitCustomer: (customerId: number, name: string, amount: number, coupon?: { quantity: number }) => void;
  busy: boolean;
  allowOverpayment: boolean;
}) {
  const [methods, setMethods] = useState<OtherPaymentMethod[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [customers, setCustomers] = useState<CustomerPaymentCandidate[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [customerError, setCustomerError] = useState("");
  const [customersLoading, setCustomersLoading] = useState(true);
  const [entry, setEntry] = useState("0");
  const [hasManualInput, setHasManualInput] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const submitting = useRef(false);
  const { ref: methodListRef, hints: methodHints, onScroll: onMethodScroll } = useVerticalScroll(methods.length);
  const { ref: customerListRef, hints: customerHints, onScroll: onCustomerScroll } = useVerticalScroll(customers.length);
  useEffect(() => {
    let active = true;
    fetch("/api/pos-settings/other-payments?pos=1", { cache: "no-store" })
      .then(async response => { const result = await response.json() as { success?: boolean; methods?: OtherPaymentMethod[]; message?: string }; if (!response.ok || !result.success) throw new Error(result.message ?? "기타결제 수단을 불러오지 못했습니다."); return result.methods ?? []; })
      .then(rows => {
        if (!active) return;
        setMethods(rows);
        setSelectedId(null);
        setEntry("0");
        setHasManualInput(false);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "기타결제 수단을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [remaining]);
  useEffect(() => {
    let active = true;
    fetch("/api/pos/customers?includeBalance=1", { cache: "no-store" })
      .then(async response => {
        const result = await response.json() as { success?: boolean; customers?: CustomerPaymentCandidate[]; message?: string };
        if (!response.ok || !result.success || !Array.isArray(result.customers)) throw new Error(result.message ?? "고객 목록을 불러오지 못했습니다.");
        return result.customers;
      })
      .then(rows => { if (active) setCustomers(rows); })
      .catch(reason => { if (active) setCustomerError(reason instanceof Error ? reason.message : "고객 목록을 불러오지 못했습니다."); })
      .finally(() => { if (active) setCustomersLoading(false); });
    return () => { active = false; };
  }, []);
  const selected = methods.find(method => method.id === selectedId);
  const selectedCustomer = customers.find(customer => customer.customerId === selectedCustomerId);
  const entered = Number(entry || 0);
  const unit = selected?.inputType === "QUANTITY" ? Number(selected.unitAmount) : 0;
  const submitted = !selected ? 0 : selected.inputType === "QUANTITY" ? entered * unit : hasManualInput ? entered : remaining;
  const applied = Math.min(submitted, remaining);
  const balance = selected?.inputType === "QUANTITY" ? Math.max(0, remaining - submitted) : Math.max(0, submitted - applied);
  const cashChangeAmount = Math.max(0, submitted - applied);
  const cashChangeApplies = Boolean(selected?.cashChangeEnabled === 1 && cashChangeAmount > 0);
  const cashChangeEligible = Boolean(cashChangeApplies && selected?.cashChangeMinPercent !== null && meetsCashChangeThreshold(applied, submitted, selected?.cashChangeMinPercent ?? 101));
  const hasValidInput = Boolean(selected && (selected.inputType === "AMOUNT" && !hasManualInput || Number.isSafeInteger(entered) && entered > 0));
  const valid = Boolean(selected && hasValidInput && Number.isSafeInteger(submitted) && submitted > 0 && submitted <= 999999999999 && (selected.inputType === "QUANTITY" || submitted <= remaining || allowOverpayment || selected.cashChangeEnabled === 1));
  const couponUnitAmount = selectedCustomer?.fixedCouponAmount ?? 0;
  const customerCouponMode = Boolean(selectedCustomer?.usesFixedCoupon && couponUnitAmount > 0);
  const customerCouponQuantity = customerCouponMode ? entered : null;
  const customerPaymentAmount = selectedCustomer ? customerCouponMode ? couponUnitAmount * entered : hasManualInput ? entered : customerRemaining : 0;
  const customerCouponApplied = Math.min(customerPaymentAmount, customerRemaining);
  const customerCouponOverage = selectedCustomer && customerCouponMode && entered > 0 ? resolveQuantityOverage({
    tenderedAmount: customerPaymentAmount,
    appliedAmount: customerCouponApplied,
    balancePolicy: selectedCustomer.fixedCouponBalancePolicy,
    cashChangeEnabled: selectedCustomer.fixedCouponCashChangeEnabled,
    cashChangeMinPercent: selectedCustomer.fixedCouponCashChangeMinPercent,
    customerId: selectedCustomer.customerId,
  }) : { cashChange: 0, forfeited: 0, error: null as "THRESHOLD_MISSING" | "THRESHOLD_NOT_MET" | "CHANGE_DISABLED" | null };
  const customerCouponRemaining = Math.max(0, customerRemaining - customerCouponApplied);
  const validCustomerPayment = Boolean(selectedCustomer && Number.isSafeInteger(customerPaymentAmount) && customerPaymentAmount > 0 && customerPaymentAmount <= 999999999999 && (customerCouponMode
    ? Number.isSafeInteger(entered) && entered > 0 && entered <= 9999 && customerCouponOverage.error === null
    : customerPaymentAmount <= customerRemaining));
  const append = (key: string) => {
    if (key === "C") {
      setEntry("0");
      setHasManualInput(false);
      return;
    }
    if (key === "BS") {
      if (!hasManualInput) return;
      const next = entry.slice(0, -1);
      setEntry(next || "0");
      setHasManualInput(next.length > 0);
      return;
    }
    setEntry(current => `${hasManualInput ? current : ""}${key}`.replace(/^0+(?=\d)/, "").slice(0, customerCouponMode ? 4 : 9));
    setHasManualInput(true);
  };
  const confirm = async () => {
    if (busy || submitting.current) return;
    if (selectedCustomer) {
      if (!validCustomerPayment) { setError("고객결제 금액은 받을금액 이하여야 합니다."); return; }
      setError("");
      submitCustomer(selectedCustomer.customerId, selectedCustomer.name, customerPaymentAmount, customerCouponQuantity === null ? undefined : { quantity: customerCouponQuantity });
      close();
      return;
    }
    if (!selected || !valid) return;
    submitting.current = true;
    setError("");
    const inputValue = selected.inputType === "AMOUNT" && !hasManualInput ? remaining : entered;
    try {
      const result = await submit(selected.id, inputValue, submitted, selected.name, selected.cashChangeEnabled === 1);
      if (result.ok) close();
      else setError(result.message ?? "결제에 실패했습니다.");
    } finally { submitting.current = false; }
  };
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4">
    <section aria-modal="true" className="flex h-[min(790px,calc(100dvh-2rem))] w-full max-w-[644.92px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog">
      <PosSubHeader backLabel="기타결제 닫기" disabled={busy} onBack={close} title="기타 결제" />
      <div className="grid min-h-0 flex-1 grid-cols-[207px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-r border-slate-200">
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <h2 className="mb-3 px-1 text-base font-bold text-slate-700">결제수단</h2>
            <div className="relative min-h-0 flex-1">
              <div aria-label="기타결제수단 목록" className="h-full overflow-y-auto overscroll-y-contain [scroll-snap-type:y_mandatory] [scrollbar-width:none] [-ms-overflow-style:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden [touch-action:pan-y]" onScroll={onMethodScroll} ref={methodListRef}>
                {loading && <p className="p-2 text-slate-500">불러오는 중...</p>}
                {!loading && methods.length === 0 && <p className="p-2 text-slate-500">설정된 결제수단이 없습니다.</p>}
                {methods.map(method => <button aria-pressed={selectedId === method.id} className={`mb-2 min-h-16 w-full rounded-xl border p-2 text-lg font-bold [scroll-snap-align:start] [scroll-snap-stop:always] ${selectedId === method.id ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white"}`} disabled={busy} key={method.id} onClick={() => { setSelectedId(method.id); setSelectedCustomerId(null); setEntry("0"); setHasManualInput(false); setError(""); }} type="button">{method.name}</button>)}
              </div>
              <VerticalScrollIndicators above={methodHints.above} below={methodHints.below} />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200 p-3">
            <h2 className="mb-3 px-1 text-base font-bold text-slate-700">고객결제</h2>
            <div className="relative min-h-0 flex-1">
              <div aria-label="고객결제 고객 목록" className="h-full overflow-y-auto overscroll-y-contain [scroll-snap-type:y_mandatory] [scrollbar-width:none] [-ms-overflow-style:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden [touch-action:pan-y]" onScroll={onCustomerScroll} ref={customerListRef}>
                {customersLoading && <p className="p-2 text-sm text-slate-500">불러오는 중...</p>}
                {customerError && <p className="p-2 text-sm text-red-600" role="alert">{customerError}</p>}
                {!customersLoading && !customerError && customers.length === 0 && <p className="p-2 text-sm text-slate-500">고객이 없습니다.</p>}
                {customers.map(customer => <button aria-pressed={selectedCustomerId === customer.customerId} className={`mb-2 flex min-h-14 w-full items-center justify-center rounded-xl border p-2 text-center text-lg font-bold [scroll-snap-align:start] [scroll-snap-stop:always] ${selectedCustomerId === customer.customerId ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 bg-white"}`} disabled={busy} key={customer.customerId} onClick={() => { setSelectedCustomerId(customer.customerId); setSelectedId(null); setEntry("0"); setHasManualInput(false); setError(""); }} type="button">{customer.name.trim() || "—"}</button>)}
              </div>
              <VerticalScrollIndicators above={customerHints.above} below={customerHints.below} />
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-col items-center px-6 py-6">
          <div className="flex min-h-0 w-[337px] max-w-full flex-1 flex-col">
            <div className={`w-full shrink-0 px-[5px] text-lg ${selected?.inputType === "QUANTITY" || customerCouponMode ? "space-y-4" : "space-y-1"}`}>
              <div className="flex min-w-0 items-center justify-between gap-3">
                <h2 className="min-w-0 truncate text-xl font-extrabold" title={selectedCustomer ? selectedCustomer.name : selected?.name}>{selectedCustomer ? selectedCustomer.name.trim() || "—" : selected?.name ?? "결제수단 또는 고객을 선택해 주세요"}</h2>
                {selectedCustomer && <b className={`shrink-0 ${selectedCustomer.tradeBalance > 0 ? "text-blue-700" : selectedCustomer.tradeBalance < 0 ? "text-red-600" : ""}`}>{selectedCustomer.tradeBalance < 0 ? "-" : ""}{formatMoney(Math.abs(selectedCustomer.tradeBalance))}</b>}
              </div>
              {customerCouponMode && entered > 0 && customerCouponOverage.error && <p className="w-full text-center text-sm font-semibold text-red-600" role="alert">{customerCouponOverage.error === "THRESHOLD_NOT_MET" ? `${selectedCustomer?.fixedCouponCashChangeMinPercent}% 이상 사용 시 현금 거스름 가능` : customerCouponOverage.error === "THRESHOLD_MISSING" ? "현금 거스름 기준 설정을 확인해 주세요." : "이 쿠폰은 잔액 현금반환이 설정되어 있지 않습니다."}</p>}
              <div className="flex items-center justify-between"><span>받을금액</span><b className={selected?.inputType === "QUANTITY" || customerCouponMode ? "font-extrabold text-blue-700" : "text-2xl font-extrabold text-blue-700"}>{formatMoney(selectedCustomer ? customerRemaining : remaining)}</b></div>
              {customerCouponMode ? <>
                {entered > 0
                  ? <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"><span>쿠폰금액</span><span className="min-w-0 text-center">{formatMoney(couponUnitAmount)} × {entered}매</span><b className="whitespace-nowrap">{formatMoney(customerPaymentAmount)}</b></div>
                  : <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2"><span>쿠폰금액</span><span className="min-w-0 text-center">{formatMoney(couponUnitAmount)}</span></div>}
                <div className="flex items-center justify-between"><span>남은금액</span><b>{formatMoney(customerCouponRemaining)}</b></div>
                {customerCouponOverage.cashChange > 0 && <div className="flex justify-between text-red-600"><span>현금 거스름</span><b>{formatMoney(customerCouponOverage.cashChange)}</b></div>}
              </> : selected?.inputType === "QUANTITY" ? <>
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"><span>정액권</span><span className="min-w-0 text-center">{entered > 0 ? `${formatMoney(unit)} × ${entered}매` : formatMoney(unit)}</span><b className="whitespace-nowrap">{formatMoney(submitted)}</b></div>
                {cashChangeApplies ? cashChangeEligible
                  ? <div className="flex justify-between text-red-600"><span>현금 거스름</span><b>{formatMoney(cashChangeAmount)}</b></div>
                  : <p className="w-full text-center text-sm font-semibold text-red-600" role="alert">{selected?.cashChangeMinPercent}% 이상 사용 시 현금 거스름 가능</p>
                  : <div className="flex justify-between"><span>남은금액</span><b>{formatMoney(balance)}</b></div>}
              </> : <>
                <div className="flex items-center justify-between"><span>{cashChangeApplies ? selected?.name : selectedCustomer ? "고객결제" : "결제금액"}</span><b className="text-2xl font-extrabold text-slate-900">{formatMoney(cashChangeApplies ? submitted : selectedCustomer ? customerPaymentAmount : applied)}</b></div>
                {cashChangeApplies && (cashChangeEligible
                  ? <div className="flex justify-between text-red-600"><span>현금 거스름</span><b>{formatMoney(cashChangeAmount)}</b></div>
                  : <p className="w-full text-center text-sm font-semibold text-red-600" role="alert">{selected?.cashChangeMinPercent}% 이상 사용 시 현금 거스름 가능</p>)}
              </>}
            </div><div className="flex h-[440px] min-h-0 shrink flex-col">
              <NumericInputKeypad disabled={busy || (!selected && !selectedCustomer)} inputLabel={customerCouponMode ? "쿠폰 매수" : undefined} onKey={append} keys={selected?.inputType === "QUANTITY" || customerCouponMode ? ["7", "8", "9", "4", "5", "6", "1", "2", "3", "BS", "0", "C"] : undefined} value={customerCouponMode ? String(entered) : formatMoney(entered)} />
            </div>
            {error && <p aria-live="polite" className="mt-2 text-center font-bold text-red-600">{error}</p>}
            <button className="mt-4 min-h-[72px] w-full shrink-0 rounded-xl bg-blue-600 text-xl font-extrabold text-white disabled:bg-slate-200 disabled:text-slate-400" disabled={busy || (selectedCustomer ? !validCustomerPayment : !valid)} onClick={() => void confirm()} type="button">확인</button>
          </div>
        </div>
      </div>
    </section>
  </div>;
}
