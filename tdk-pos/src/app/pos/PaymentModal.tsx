"use client";

import { useEffect, useRef, useState } from "react";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import { useHorizontalScroll } from "@/hooks/useHorizontalScroll";
import { formatMoney } from "@/lib/format-money";
import OtherPaymentDialog from "./OtherPaymentDialog";
import CustomerSelectDialog, { type SelectedCustomer } from "./CustomerSelectDialog";
import PosSubHeader from "./PosSubHeader";

type Discount = { label: string; amount: number; type: string };
type Payment = {
  paymentId: number;
  amount: number;
  appliedAmount: number;
  prepaidCreditAmount: number;
  methodCode: string;
  methodName: string;
  paidAt: string;
  approvalNo: string | null;
  note: string | null;
  methodNameSnapshot: string | null;
  quantity: number | null;
  customerCouponQuantity: number | null;
  receivedAmount: number;
  changeAmount: number;
};
type State = {
  gross: number;
  discounts: Discount[];
  total: number;
  paid: number;
  remaining: number;
  prepaidCredit: number;
  checkoutId: number | null;
  payments: Payment[];
  isPartyBill: boolean;
  tableNos: string[];
};
type OverpaymentPrompt = {
  kind: "CARD" | "CASH" | "OTHER";
  methodLabel: string;
  amount: number;
  due: number;
  excess: number;
  requestBody: Record<string, unknown>;
};
type StagedCustomerPayment = { customerId: number; name: string; amount: number; requestKey: string; couponQuantity: number | null };
type PaymentDeletionTarget = { kind: "SAVED"; payment: Payment } | { kind: "STAGED_CUSTOMER" };
const money = (amount: number) => formatMoney(amount);
const newCustomerPaymentRequestKey = () => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
const paymentMethodLabel = (payment: Payment) => {
  if (payment.methodCode === "CUSTOMER_PAYMENT" && payment.customerCouponQuantity) return `쿠폰 ${payment.customerCouponQuantity}매 고객결제`;
  if (payment.methodNameSnapshot) return payment.quantity ? `${payment.methodNameSnapshot} × ${payment.quantity}매` : payment.methodNameSnapshot;
  const labels: Record<string, string> = {
    CARD: "카드",
    CASH: "현금",
    TRANSFER: "이체",
    OTHER: "기타",
  };
  return labels[payment.methodCode] ?? payment.methodName;
};
const paymentInfoLabelStyle = "text-[22px] font-normal";
const paymentInfoAmountStyle = "text-[22px] font-bold";
const paymentInfoSmallLabelStyle = "text-[20px] font-normal";
const paymentInfoSmallAmountStyle = "text-[20px] font-bold";
const paymentInfoSmallAlignedAmountStyle = "text-[20px] font-bold pr-[13px]";
const paymentInfoAlignedAmountStyle = `${paymentInfoAmountStyle} pr-[13px]`;
const paymentInfoRowStyle = "flex justify-between leading-7";
const paymentSummaryRowStyle = "grid min-h-11 grid-cols-[1fr_auto] items-center leading-7";
const paymentInfoRowGapStyle = "space-y-[7px]";
const paymentHistoryRowGapStyle = "space-y-[14px]";
export default function PaymentModal({
  tableId,
  tableNo,
  close,
  completed,
}: {
  tableId: number;
  tableNo: string;
  close: () => void;
  completed: (hasCashPayment: boolean) => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const requestInFlight = useRef(false);
  const [error, setError] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [stagedCustomerPayment, setStagedCustomerPayment] = useState<StagedCustomerPayment | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);
  const [customerSelectOpen, setCustomerSelectOpen] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<PaymentDeletionTarget | null>(null);
  const [cancelError, setCancelError] = useState("");
  const [resetPaymentsConfirm, setResetPaymentsConfirm] = useState(false);
  const [overpaymentPrompt, setOverpaymentPrompt] = useState<OverpaymentPrompt | null>(null);
  const [overpaymentBlockDialog, setOverpaymentBlockDialog] = useState(false);
  const [cardErrorDialog, setCardErrorDialog] = useState("");
  const [initialPaymentIds, setInitialPaymentIds] = useState<number[]>([]);
  const { ref: paymentMethodsRef, hints: scrollHints, handlers: paymentScrollHandlers } = useHorizontalScroll(state !== null);
  useEffect(() => {
    let active = true;
    fetch(`/api/checkouts?tableId=${tableId}`)
      .then(async (response) => ({ response, result: (await response.json()) as { success?: boolean; message?: string } & State }))
      .then(({ response, result }) => {
        if (!active) return;
        if (!response.ok || !result.success) {
        }
        setInitialPaymentIds(result.payments.map((payment) => payment.paymentId));
        setState({ gross: result.gross, discounts: result.discounts, total: result.total, paid: result.paid, remaining: result.remaining, prepaidCredit: result.prepaidCredit ?? 0, checkoutId: result.checkoutId, payments: result.payments, isPartyBill: result.isPartyBill, tableNos: result.tableNos });
      })
      .catch(() => { if (active) setError("결제 정보를 불러올 수 없습니다."); });
    return () => { active = false; };
  }, [tableId]);
  const entered = Number(input || 0);
  const displayRemaining = Math.max(0, (state?.remaining ?? 0) - (stagedCustomerPayment?.amount ?? 0));
  const displayOverpayment = Math.max(0, (state?.paid ?? 0) - (state?.total ?? 0));
  const append = (key: string) => {
    if (busy) return;
    setInput((current) =>
      key === "C"
        ? ""
        : `${current}${key}`.replace(/^0+(?=\d)/, "").slice(0, 9),
    );
  };
  const request = async (body: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> => {
    if (requestInFlight.current) return { ok: false };
    requestInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, ...body }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
        completed?: boolean;
        change?: number;
        tendered?: number;
        state?: State;
        debugPhase?: string;
        debugMessage?: string;
      };
      if (!response.ok || !result.success) {
        const message = result.message ?? "결제를 처리하지 못했습니다.";
        if (result.debugPhase || result.debugMessage) {
          console.error("[checkout] payment request failed", { status: response.status, action: body.action, phase: result.debugPhase, serverError: result.debugMessage });
        }
        setError(message);
        return { ok: false, message };
      }
      setInput("");
      if (result.completed) {
        completed(Boolean(state?.payments.some((payment) => payment.methodCode === "CASH")));
        return { ok: true };
      }
      if (result.state) {
        setState(result.state);
        setStagedCustomerPayment(current => current && current.amount > result.state!.remaining ? null : current);
      }
      return { ok: true };
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      return { ok: false, message: "네트워크 오류가 발생했습니다." };
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };
  const submitCard = (amount: number, confirmed = false) => {
    return request({
      action: "PAY",
      methodCode: "CARD",
      amount,
      customerId: selectedCustomer?.customerId,
      prepaidOverpaymentConfirmed: confirmed,
    });
  };
  const resolveOverpayment = async (confirmed: boolean) => {
    if (!overpaymentPrompt || busy) return;
    if (overpaymentPrompt.kind === "CARD" && !confirmed) {
      setOverpaymentPrompt(null);
      setCardErrorDialog("카드 결제금액이 받을금액보다 많습니다.");
      return;
    }
    const body = { ...overpaymentPrompt.requestBody, prepaidOverpaymentConfirmed: confirmed };
    await request(body);
    setOverpaymentPrompt(null);
  };
  const submitOtherPayment = (paymentMethodId: number, inputValue: number, tendered: number, methodName: string, cashChangeEnabled: boolean, quantityMode: boolean) => {
    if (stagedCustomerPayment && tendered > displayRemaining) {
      return Promise.resolve({ ok: false, message: "고객결제 예정액을 제외한 받을금액 이내로 입력해 주세요." });
    }
    const requestBody = { action: "PAY_OTHER", paymentMethodId, inputValue, quantityMode, customerId: selectedCustomer?.customerId };
    if (state && selectedCustomer && tendered > state.remaining && !cashChangeEnabled) {
      setOverpaymentPrompt({ kind: "OTHER", methodLabel: methodName, amount: tendered, due: state.remaining, excess: tendered - state.remaining, requestBody });
      setOtherOpen(false);
      return Promise.resolve({ ok: true });
    }
    return request(requestBody);
  };
  const stageCustomerPayment = (customerId: number, name: string, amount: number, coupon?: { quantity: number }): boolean => {
    setStagedCustomerPayment({ customerId, name, amount, requestKey: newCustomerPaymentRequestKey(), couponQuantity: coupon?.quantity ?? null });
    setInput("");
    setError("");
    setOtherOpen(false);
    return true;
  };
  const pay = (methodCode: string, otherLabel?: string) => {
    if (displayRemaining <= 0) {
      setError("");
      setCardErrorDialog("받을 금액이 없습니다.");
      return;
    }
    if (stagedCustomerPayment && entered > displayRemaining) {
      setError("고객결제 예정액을 제외한 받을금액 이내로 입력해 주세요.");
      return;
    }
    if (methodCode === "CARD") {
      const amount = entered || displayRemaining;
      if (state && amount > state.remaining) {
        if (!selectedCustomer) {
          setCardErrorDialog("카드 결제금액이 받을금액보다 많습니다.");
          return;
        }
        setOverpaymentPrompt({ kind: "CARD", methodLabel: "카드", amount, due: state.remaining, excess: amount - state.remaining, requestBody: { action: "PAY", methodCode, amount, customerId: selectedCustomer.customerId } });
        return;
      }
      void submitCard(amount);
      return;
    }
    const amount = entered || displayRemaining;
    if (methodCode === "CASH" && state && selectedCustomer && amount > state.remaining) {
      setOverpaymentPrompt({ kind: "CASH", methodLabel: "현금", amount, due: state.remaining, excess: amount - state.remaining, requestBody: { action: "PAY", methodCode, amount, customerId: selectedCustomer.customerId, otherLabel } });
      return;
    }
    void request({ action: "PAY", methodCode, amount: amount || undefined, customerId: selectedCustomer?.customerId, otherLabel });
  };
  const complete = () => {
    if (displayOverpayment > 0) {
      setOverpaymentBlockDialog(true);
      return;
    }
    void request(stagedCustomerPayment
      ? { action: "PAY_CUSTOMER", customerId: stagedCustomerPayment.customerId, amount: stagedCustomerPayment.amount, requestKey: stagedCustomerPayment.requestKey, couponQuantity: stagedCustomerPayment.couponQuantity }
      : { action: "COMPLETE" });
  };
  const cancelPayment = async () => {
    if (!deletionTarget || busy) return;
    if (deletionTarget.kind === "STAGED_CUSTOMER") {
      setStagedCustomerPayment(null);
      setDeletionTarget(null);
      return;
    }
    setBusy(true);
    setCancelError("");
    try {
      const response = await fetch("/api/checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, action: "CANCEL_PAYMENT", paymentId: deletionTarget.payment.paymentId }),
      });
      const result = (await response.json()) as { success?: boolean; message?: string; state?: State };
      if (!response.ok || !result.success || !result.state) {
        setCancelError(result.message ?? "결제를 취소할 수 없습니다.");
        return;
      }
      setState(result.state);
      setDeletionTarget(null);
    } catch {
      setCancelError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  const resetPayments = async () => {
    if (!state || busy) return;
    const paymentIds = state.payments.map(payment => payment.paymentId);
    setBusy(true);
    requestInFlight.current = true;
    setCancelError("");
    try {
      let refreshedState = state;
      for (const paymentId of paymentIds) {
        const response = await fetch("/api/checkouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId, action: "CANCEL_PAYMENT", paymentId }),
        });
        const result = await response.json() as { success?: boolean; message?: string; state?: State };
        if (!response.ok || !result.success || !result.state) throw new Error(result.message ?? "결제를 초기화할 수 없습니다.");
        refreshedState = result.state;
        setState(refreshedState);
      }
      setStagedCustomerPayment(null);
      setInput("");
      setResetPaymentsConfirm(false);
    } catch (resetError) {
      setCancelError(resetError instanceof Error ? resetError.message : "결제 초기화 중 오류가 발생했습니다.");
      try {
        const response = await fetch(`/api/checkouts?tableId=${tableId}`);
        const refreshed = await response.json() as { success?: boolean } & State;
        if (response.ok && refreshed.success) setState(refreshed);
      } catch {
        // Keep the last successfully refreshed payment state visible.
      }
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };
  // Approved payments are already persisted by the payment API.  Closing this
  // modal intentionally leaves a partial checkout and its OPEN table session
  // untouched so that it can be resumed as a prepaid payment later.
  const requestClose = () => close();
  if (!state)
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55">
        <div className="rounded-2xl bg-white px-8 py-6 text-xl font-bold">
          결제 정보를 불러오는 중...
        </div>
      </div>
    );
  const displayedTableNos = state.isPartyBill && state.tableNos.length > 1
    ? state.tableNos.join(" 쨌 ")
    : tableNo;
  const discountAmount = state.discounts.reduce(
    (sum, discount) => sum + discount.amount,
    0,
  );
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
      <section
        aria-modal="true"
        className={`flex ${state.isPartyBill ? "h-[min(760px,calc(100dvh-2rem))]" : "h-[min(752px,calc(100dvh-2rem-8px))]"} w-full max-w-[750px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}
        role="dialog"
      >
        <PosSubHeader backLabel="결제창 닫기" backIconSize={19} backVisualSize={39} className="!min-h-[63px] !py-1.5" disabled={busy} level={1} onBack={requestClose} title="결제" titleTrailing={<span className="-ml-2 inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-2xl font-bold"><span aria-hidden="true">..</span><span className="text-[35px] leading-none">{displayedTableNos}</span><span className="text-[33px]">T</span></span>} trailing={<div className="relative left-[20px] flex min-w-0 items-end">
            <button
              className="h-[52px] w-fit min-w-[136px] max-w-[360px] shrink-0 rounded-none border-0 bg-transparent px-3 text-2xl font-extrabold text-white/90 shadow-none transition-colors hover:text-white active:text-white focus-visible:outline-none disabled:opacity-50"
              disabled={busy}
              onClick={() => setCustomerSelectOpen(true)}
              title={selectedCustomer?.name ?? "고객"}
              type="button"
            ><span className="inline-flex max-w-full items-center justify-center gap-1"><span className="whitespace-nowrap">{selectedCustomer?.name ?? "고객"}</span><span aria-hidden="true" className="shrink-0 text-[22px] leading-none">⋮</span></span></button>
          </div>} />
        <div className="grid min-h-0 flex-1 grid-cols-[44%_56%]">
          <section className="flex min-h-0 flex-col border-r border-slate-200 px-6 py-6" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
            <div className="-mr-4 min-h-0 flex-1 overflow-y-auto pr-4">
            <div className="rounded-[9px] border border-slate-100 bg-slate-50 px-3 py-4 shadow-[3px_4px_10px_rgba(15,23,42,0.10)]">
              <div className="space-y-2.5">
                <div className={paymentSummaryRowStyle}>
                  <span className="text-[20px] font-normal">주문금액</span>
                  <b className="text-[20px] font-bold">{money(state.gross)}</b>
                </div>
                {discountAmount > 0 && (
                  <div className={`${paymentSummaryRowStyle} text-slate-900`}>
                    <span className="text-[20px] font-normal">할인금액</span>
                    <b className={`text-[20px] font-bold text-red-600`}>-{money(discountAmount)}</b>
                  </div>
                )}
                <div className={`${paymentSummaryRowStyle} gap-3 text-[20px] font-extrabold text-blue-700`}>
                  <span className={`text-[20px] font-normal text-slate-900`}>결제금액</span>
                  <b className={`text-[20px] font-bold text-blue-700`}>{money(state.total)}</b>
                </div>
              </div>
            </div>
            {(state.payments.length > 0 || stagedCustomerPayment) && <div className="mt-7">
              <div className={`${paymentHistoryRowGapStyle} rounded-[9px] border border-slate-100 bg-slate-50 px-3 py-3 shadow-[3px_4px_10px_rgba(15,23,42,0.10)]`}>
                {state.payments.map((payment) => {
                  const prepaid = initialPaymentIds.includes(payment.paymentId);
                  return (
                  <div key={payment.paymentId}>
                  <button
                    aria-label={`${prepaid ? "선불" : ""}${paymentMethodLabel(payment)} ${money(payment.receivedAmount)} 결제내역 삭제`}
                    className={`${paymentInfoRowStyle} w-full rounded-lg py-0 text-left font-normal text-slate-900 transition hover:bg-slate-50 active:bg-slate-100`}
                    disabled={busy}
                    onClick={() => {
                      setCancelError("");
                      setDeletionTarget({ kind: "SAVED", payment });
                    }}
                    type="button"
                  >
                    <span className={`${prepaid ? paymentInfoSmallLabelStyle : paymentInfoLabelStyle} pl-3`}>
                      {prepaid ? "선불" : ""}
                      {paymentMethodLabel(payment)}
                    </span>
                    <b className={prepaid ? paymentInfoSmallAlignedAmountStyle : paymentInfoAlignedAmountStyle}>{money(payment.receivedAmount)}</b>
                  </button>
                  {payment.changeAmount > 0 && (
                    <div className={`${paymentInfoRowStyle} mt-[7px] text-slate-900`}>
                      <span className={`${prepaid ? paymentInfoSmallLabelStyle : paymentInfoLabelStyle} pl-3`}>{payment.methodCode === "CASH" || payment.methodNameSnapshot ? "현금 거스름" : "거스름돈"}</span>
                      <b className={paymentInfoAlignedAmountStyle}>-{money(payment.changeAmount)}</b>
                    </div>
                  )}
                  </div>
                  );
                })}
                {stagedCustomerPayment && <button
                  aria-label={`${stagedCustomerPayment.name} 고객결제 예정 내역 삭제`}
                  className={`${paymentInfoRowStyle} w-full rounded-lg py-0 text-left font-normal text-slate-900 transition hover:bg-slate-50 active:bg-slate-100`}
                  disabled={busy}
                  onClick={() => { setCancelError(""); setDeletionTarget({ kind: "STAGED_CUSTOMER" }); }}
                  type="button"
                ><span className={`min-w-0 truncate pl-3 ${paymentInfoLabelStyle}`}>{stagedCustomerPayment.name}{stagedCustomerPayment.couponQuantity ? ` · 쿠폰 ${stagedCustomerPayment.couponQuantity}매` : ""}</span><b className={`shrink-0 ${paymentInfoAlignedAmountStyle}`}>{money(stagedCustomerPayment.amount)}</b></button>}
              </div>
              <div className="relative mt-7">
                <div className="overflow-hidden rounded-[9px] border border-slate-100 bg-slate-50 px-3 py-3 shadow-[3px_4px_10px_rgba(15,23,42,0.10)]">
                  <div className={`${paymentInfoRowStyle} text-[20px] leading-7 font-extrabold ${displayOverpayment > 0 || displayRemaining > 0 ? "text-red-600" : "text-slate-900"}`}>
                    <span className={`${paymentInfoSmallLabelStyle} text-slate-900`}>{displayOverpayment > 0 ? "초과결제" : "받을금액"}</span>
                    <b className={paymentInfoSmallAmountStyle}>{money(displayOverpayment > 0 ? displayOverpayment : displayRemaining)}</b>
                  </div>
                </div>
              </div>
              {state.payments.filter(payment => payment.amount > payment.appliedAmount || payment.prepaidCreditAmount > 0).map(payment => (
                <div className={`mt-7 rounded-[9px] border border-slate-100 bg-slate-50 px-3 py-3 shadow-[3px_4px_10px_rgba(15,23,42,0.10)] ${paymentInfoRowGapStyle} text-slate-900`} key={`prepaid-${payment.paymentId}`}>
                  <div className={paymentInfoRowStyle}><span className={paymentInfoSmallLabelStyle}>매출 적용</span><b className={paymentInfoSmallAmountStyle}>{money(payment.appliedAmount)}</b></div>
                  {payment.prepaidCreditAmount > 0 && <div className={paymentInfoRowStyle}><span className={paymentInfoSmallLabelStyle}>선불 적립</span><b className={paymentInfoSmallAmountStyle}>{money(payment.prepaidCreditAmount)}</b></div>}
                   {payment.changeAmount > 0 && <div className={paymentInfoRowStyle}><span className={paymentInfoSmallLabelStyle}>{payment.methodCode === "CASH" || payment.methodNameSnapshot ? "현금 거스름" : "거스름돈"}</span><b className={paymentInfoSmallAmountStyle}>{money(payment.changeAmount)}</b></div>}
                </div>
              ))}
            </div>}
            </div>
            <button
              className="mt-3 min-h-[72px] w-full shrink-0 rounded-lg border border-slate-300 bg-white text-lg font-bold text-slate-900 transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40"
              disabled={busy || (!state.payments.length && !stagedCustomerPayment)}
              onClick={() => { setCancelError(""); setResetPaymentsConfirm(true); }}
              type="button"
            >결제 초기화</button>
          </section>
          <section className="flex min-h-0 flex-col px-6 py-6">
            <NumericInputKeypad disabled={busy} inputLabel="" inputOffset={-2} onKey={append} value={money(entered)} />
            {error && <p className="mt-2 text-center text-base font-bold text-red-600">{error}</p>}
            <div className="relative z-10 mt-4 w-[365px] self-center bg-white">
              <div
                aria-label="결제수단 선택"
                className="horizontal-select-scroll payment-method-scroll flex w-full flex-nowrap gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain bg-white px-[14px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [touch-action:pan-x]"
                {...paymentScrollHandlers}
                ref={paymentMethodsRef}
                role="group"
              >
              <button
                className="min-h-[76px] w-[104px] shrink-0 rounded-xl border border-[#D5DCE5] bg-white text-xl font-extrabold text-slate-900 transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D5DCE5]"
                disabled={busy}
                onClick={() => pay("CARD")}
                type="button"
              >
                카드
              </button>
              <button
                className="min-h-[76px] w-[104px] shrink-0 rounded-xl border border-[#D5DCE5] bg-white text-xl font-extrabold text-slate-900 transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D5DCE5]"
                disabled={busy}
                onClick={() => pay("CASH")}
                type="button"
              >
                현금
              </button>
              <button
                aria-label="기타결제"
                className="min-h-[76px] w-[104px] shrink-0 rounded-xl border border-[#D5DCE5] bg-white text-xl font-extrabold text-slate-900 transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D5DCE5]"
                disabled={busy}
                onClick={() => { if (displayRemaining <= 0) { setError(""); setCardErrorDialog("받을 금액이 없습니다."); return; } setError(""); setOtherOpen(true); }}
                type="button"
              >
                기타결제
              </button>
              </div>
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-[10px] bg-white" />
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-[10px] bg-white" />
              {scrollHints.left && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex w-[14px] items-center justify-center text-[32px] leading-none text-slate-500">⋮</span>
              )}
              {scrollHints.right && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex w-[14px] items-center justify-center text-[32px] leading-none text-slate-500">⋮</span>
              )}
            </div>
            <button
              className="mt-3 min-h-[72px] w-[337px] self-center rounded-xl bg-blue-600 text-xl font-extrabold text-white disabled:bg-slate-200 disabled:text-slate-400"
              disabled={busy || displayRemaining > 0}
              onClick={complete}
              type="button"
            >결제완료</button>
          </section>
        </div>
      </section>
      {otherOpen && (
        <OtherPaymentDialog allowOverpayment={Boolean(selectedCustomer) && !stagedCustomerPayment} busy={busy} close={() => setOtherOpen(false)} remaining={displayRemaining} customerRemaining={state.remaining} submit={submitOtherPayment} submitCustomer={stageCustomerPayment} />
      )}
      {overpaymentPrompt && <ConfirmOverpaymentDialog
        methodLabel={overpaymentPrompt.methodLabel}
        amount={overpaymentPrompt.amount}
        due={overpaymentPrompt.due}
        excess={overpaymentPrompt.excess}
        busy={busy}
        cancel={() => void resolveOverpayment(false)}
        confirm={() => void resolveOverpayment(true)}
      />}
      {cardErrorDialog && <CardErrorDialog message={cardErrorDialog} close={() => setCardErrorDialog("")} />}
      {overpaymentBlockDialog && <OverpaymentBlockDialog amount={displayOverpayment} close={() => setOverpaymentBlockDialog(false)} />}
      {customerSelectOpen && <CustomerSelectDialog
        selected={selectedCustomer}
        onClose={() => setCustomerSelectOpen(false)}
        onSelect={customer => { setSelectedCustomer(customer); if (customer) setCustomerSelectOpen(false); }}
      />}
      {deletionTarget && (
        <PaymentDeletionDialog
          busy={busy}
          error={cancelError}
          close={() => {
            if (busy) return;
            setCancelError("");
            setDeletionTarget(null);
          }}
          submit={() => void cancelPayment()}
        />
      )}
      {resetPaymentsConfirm && (
        <PaymentResetDialog
          busy={busy}
          error={cancelError}
          close={() => { if (!busy) { setResetPaymentsConfirm(false); setCancelError(""); } }}
          submit={() => void resetPayments()}
          paymentCount={state.payments.length}
        />
      )}
    </div>
  );
}

function PaymentDeletionDialog({
  error,
  busy,
  close,
  submit,
}: {
  error: string;
  busy: boolean;
  close: () => void;
  submit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
      <section aria-modal="true" aria-describedby="payment-deletion-prompt" className="w-full max-w-[420px] overflow-hidden rounded-2xl bg-white shadow-2xl" role="alertdialog">
        <PosSubHeader title="결제내역 삭제" />
        <div className="px-7 py-7">
          <p className="text-center text-xl font-bold text-slate-900" id="payment-deletion-prompt">이 결제내역을<br />삭제하시겠습니까?</p>
          {error && <p aria-live="polite" className="mt-4 text-center text-base font-bold text-red-600">{error}</p>}
          <div className="mt-8 grid grid-cols-2 gap-3">
            <button className="min-h-14 rounded-xl border border-slate-300 text-lg font-bold text-slate-700 disabled:opacity-40" disabled={busy} onClick={close} type="button">취소</button>
            <button className="min-h-14 rounded-xl bg-blue-600 text-lg font-extrabold text-white disabled:opacity-40" disabled={busy} onClick={submit} type="button">{busy ? "처리 중..." : "확인"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PaymentResetDialog({ paymentCount, error, busy, close, submit }: { paymentCount: number; error: string; busy: boolean; close: () => void; submit: () => void }) {
  return <div className="fixed inset-0 z-[105] flex items-center justify-center bg-slate-950/45 p-4">
    <section aria-modal="true" className="w-full max-w-[440px] overflow-hidden rounded-2xl bg-white shadow-2xl" role="alertdialog">
      <PosSubHeader backIconSize={19} backLabel="결제 초기화 닫기" backVisualSize={39} className="!min-h-[63px] !py-1.5" onBack={close} title="결제 초기화" />
      <div className="px-7 py-6">
        <p className="text-center text-lg font-bold text-slate-800">등록된 결제 {paymentCount}건을 취소하고<br />결제 입력을 초기화하시겠습니까?</p>
        {error && <p aria-live="polite" className="mt-4 text-center text-sm font-bold text-red-600">{error}</p>}
        <button className="mt-6 min-h-[53px] w-full rounded-xl bg-red-600 text-base font-extrabold text-white disabled:opacity-40" disabled={busy} onClick={submit} type="button">{busy ? "초기화 중..." : "결제 초기화"}</button>
      </div>
    </section>
  </div>;
}

function ConfirmOverpaymentDialog({ methodLabel, amount, due, excess, busy, cancel, confirm }: { methodLabel: string; amount: number; due: number; excess: number; busy: boolean; cancel: () => void; confirm: () => void }) {
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-4">
    <section aria-modal="true" className="w-full max-w-[480px] overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog">
      <PosSubHeader title={`${methodLabel} 초과결제 확인`} />
      <div className="px-7 py-6 text-lg">
        <p>{methodLabel} 금액이 받을금액보다 많습니다.</p>
        <p className="mt-2">초과금액 {money(excess)}원을 선불금으로<br />적립하시겠습니까?</p>
        <div className="mt-4 space-y-1 rounded-lg bg-slate-50 px-4 py-3 text-base text-slate-700">
          <div className="flex justify-between"><span>받을금액</span><b>{money(due)}</b></div>
          <div className="flex justify-between"><span>{methodLabel} 결제금액</span><b>{money(amount)}</b></div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button className="min-h-12 rounded-lg border border-slate-300 px-6 font-bold" disabled={busy} onClick={cancel} type="button">취소</button>
          <button className="min-h-12 rounded-lg bg-blue-600 px-6 font-bold text-white disabled:opacity-50" disabled={busy} onClick={confirm} type="button">{busy ? "처리 중..." : "확인"}</button>
        </div>
      </div>
    </section>
  </div>;
}

function OverpaymentBlockDialog({ amount, close }: { amount: number; close: () => void }) {
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4">
    <section aria-modal="true" className="w-full max-w-[420px] overflow-hidden rounded-2xl bg-white shadow-2xl" role="alertdialog">
      <PosSubHeader title="초과결제" />
      <div className="px-7 py-7 text-center text-xl font-bold text-slate-800">
        <p>결제금액보다 {money(amount)}원이 초과되었습니다.<br />기존 결제를 취소한 후 다시 결제해주세요.</p>
        <button autoFocus className="mt-7 min-h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white" onClick={close} type="button">확인</button>
      </div>
    </section>
  </div>;
}

function CardErrorDialog({ message, close }: { message: string; close: () => void }) {
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/55 p-4">
    <section aria-modal="true" className="w-full max-w-[420px] overflow-hidden rounded-2xl bg-white shadow-2xl" role="alertdialog">
      <PosSubHeader title="결제 확인" />
      <div className="px-7 py-7 text-center text-xl font-bold text-slate-800">
        <p>{message}</p>
        <button autoFocus className="mt-7 min-h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white" onClick={close} type="button">확인</button>
      </div>
    </section>
  </div>;
}
