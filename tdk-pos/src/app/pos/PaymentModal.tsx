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
const money = (amount: number) => formatMoney(amount);
const paymentMethodLabel = (payment: Payment) => {
  if (payment.methodCode === "CUSTOMER_PAYMENT" && payment.customerCouponQuantity) return `쿠폰 ${payment.customerCouponQuantity}장 고객결제`;
  if (payment.methodNameSnapshot) return payment.quantity ? `${payment.methodNameSnapshot} × ${payment.quantity}매` : payment.methodNameSnapshot;
  const labels: Record<string, string> = {
    CARD: "카드",
    CASH: "현금",
    TRANSFER: "이체",
    OTHER: "기타",
  };
  return labels[payment.methodCode] ?? payment.methodName;
};
const paymentTime = (paidAt: string) => new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).format(new Date(paidAt));

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
  const [cancelTarget, setCancelTarget] = useState<Payment | null>(null);
  const [cancelError, setCancelError] = useState("");
  const [overpaymentPrompt, setOverpaymentPrompt] = useState<OverpaymentPrompt | null>(null);
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
  const submitOtherPayment = (paymentMethodId: number, inputValue: number, tendered: number, methodName: string, cashChangeEnabled: boolean) => {
    if (stagedCustomerPayment && tendered > displayRemaining) {
      return Promise.resolve({ ok: false, message: "고객결제 예정액을 제외한 받을금액 이내로 입력해 주세요." });
    }
    const requestBody = { action: "PAY_OTHER", paymentMethodId, inputValue, customerId: selectedCustomer?.customerId };
    if (state && selectedCustomer && tendered > state.remaining && !cashChangeEnabled) {
      setOverpaymentPrompt({ kind: "OTHER", methodLabel: methodName, amount: tendered, due: state.remaining, excess: tendered - state.remaining, requestBody });
      setOtherOpen(false);
      return Promise.resolve({ ok: true });
    }
    return request(requestBody);
  };
  const stageCustomerPayment = (customerId: number, name: string, amount: number, coupon?: { quantity: number }): boolean => {
    setStagedCustomerPayment({ customerId, name, amount, requestKey: crypto.randomUUID(), couponQuantity: coupon?.quantity ?? null });
    setInput("");
    setError("");
    setOtherOpen(false);
    return true;
  };
  const pay = (methodCode: string, otherLabel?: string) => {
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
  const complete = () => void request(stagedCustomerPayment
    ? { action: "PAY_CUSTOMER", customerId: stagedCustomerPayment.customerId, amount: stagedCustomerPayment.amount, requestKey: stagedCustomerPayment.requestKey, couponQuantity: stagedCustomerPayment.couponQuantity }
    : { action: "COMPLETE" });
  const cancelPayment = async () => {
    if (!cancelTarget || busy) return;
    setBusy(true);
    setCancelError("");
    try {
      const response = await fetch("/api/checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, action: "CANCEL_PAYMENT", paymentId: cancelTarget.paymentId }),
      });
      const result = (await response.json()) as { success?: boolean; message?: string; state?: State };
      if (!response.ok || !result.success || !result.state) {
        setCancelError(result.message ?? "결제를 취소할 수 없습니다.");
        return;
      }
      setState(result.state);
      setCancelTarget(null);
    } catch {
      setCancelError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
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
        className={`flex ${state.isPartyBill ? "h-[min(760px,calc(100dvh-2rem))]" : "h-[min(752px,calc(100dvh-2rem-8px))]"} w-full max-w-[782px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}
        role="dialog"
      >
        <PosSubHeader backLabel="결제창 닫기" className="!min-h-[63px] !py-1.5" disabled={busy} level={1} onBack={requestClose} title="결제" trailing={<div className="flex min-w-0 items-end gap-5">
            <p className="flex min-w-0 items-end gap-2 whitespace-nowrap">
              <b className={`${state.isPartyBill ? "text-4xl" : "text-5xl"} min-w-0 truncate leading-none`}>{displayedTableNos}</b>
              <span className="shrink-0 pb-0.5 text-lg font-bold">테이블</span>
            </p>
            <button
              className="h-[52px] w-[136px] shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-base font-bold text-[#455A64] hover:bg-white active:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
              disabled={busy}
              onClick={() => setCustomerSelectOpen(true)}
              title={selectedCustomer?.name ?? "고객 선택"}
              type="button"
            ><span className="block truncate">{selectedCustomer?.name ?? "고객 선택"}</span></button>
          </div>} />
        <div className="grid min-h-0 flex-1 grid-cols-[44%_56%]">
          <section className="min-h-0 overflow-y-auto border-r border-slate-200 px-6 py-6">
            <div className="space-y-[7px] border-b border-slate-300 pb-5 text-lg">
              <div className="flex justify-between">
                <span>주문금액</span>
                <b>{money(state.gross)}</b>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>할인금액</span>
                  <b>-{money(discountAmount)}</b>
                </div>
              )}
              {discountAmount > 0 && <div className="flex items-center justify-between gap-3 text-2xl font-extrabold text-blue-700">
                <span>결제금액</span>
                <b>
                  {money(state.total)}
                </b>
              </div>}
            </div>
            <div className="mt-[14px]">
              <h2 className="text-xl font-bold">결제내역</h2>
              <div className="mt-[14px] space-y-[7px]">
                {state.payments.map((payment) => {
                  const prepaid = initialPaymentIds.includes(payment.paymentId);
                  return (
                  <div className="space-y-[7px]" key={payment.paymentId}>
                  <button
                    aria-label={`${prepaid ? "선불" : ""}${paymentMethodLabel(payment)} ${money(payment.receivedAmount)} 결제 취소`}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-lg transition hover:bg-slate-50 active:bg-slate-100 ${prepaid ? "text-blue-600" : "text-slate-900"}`}
                    onClick={() => {
                      setCancelError("");
                      setCancelTarget(payment);
                    }}
                    type="button"
                  >
                    <span>
                      {prepaid ? "선불" : ""}
                      {paymentMethodLabel(payment)}
                    </span>
                    <b>{money(payment.receivedAmount)}</b>
                  </button>
                  {payment.changeAmount > 0 && (
                    <div className="flex items-center justify-between px-2 text-lg text-red-600">
                      <span>{payment.methodCode === "CASH" || payment.methodNameSnapshot ? "현금 거스름" : "거스름돈"}</span>
                      <b>-{money(payment.changeAmount)}</b>
                    </div>
                  )}
                  </div>
                  );
                })}
                {stagedCustomerPayment && <button
                  aria-label={`${stagedCustomerPayment.name} 고객결제 예정 내역 삭제`}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-lg text-slate-900 transition hover:bg-slate-50 active:bg-slate-100"
                  disabled={busy}
                  onClick={() => setStagedCustomerPayment(null)}
                  title="누르면 예정 고객결제를 삭제합니다."
                  type="button"
                ><span className="min-w-0 truncate">고객결제({stagedCustomerPayment.name}){stagedCustomerPayment.couponQuantity ? ` · 쿠폰 ${stagedCustomerPayment.couponQuantity}장` : ""}</span><span className="ml-2 flex shrink-0 items-center gap-2"><b>{money(stagedCustomerPayment.amount)}</b><small className="text-sm text-slate-500">삭제</small></span></button>}
              </div>
              <div className="mt-[17px] flex justify-between border-t border-slate-300 pt-[17px] text-2xl font-extrabold text-blue-700">
                <span>받을금액</span>
                <b>{money(displayRemaining)}</b>
              </div>
              {state.payments.filter(payment => payment.amount > payment.appliedAmount || payment.prepaidCreditAmount > 0).map(payment => (
                <div className="mt-2 space-y-1 border-t border-blue-100 pt-2 text-lg font-bold text-blue-700" key={`prepaid-${payment.paymentId}`}>
                  <div className="flex justify-between"><span>매출 적용</span><b>{money(payment.appliedAmount)}</b></div>
                  {payment.prepaidCreditAmount > 0 && <div className="flex justify-between"><span>선불 적립</span><b>{money(payment.prepaidCreditAmount)}</b></div>}
                   {payment.changeAmount > 0 && <div className="flex justify-between text-red-600"><span>{payment.methodCode === "CASH" || payment.methodNameSnapshot ? "현금 거스름" : "거스름돈"}</span><b>{money(payment.changeAmount)}</b></div>}
                </div>
              ))}
            </div>
          </section>
          <section className="flex min-h-0 flex-col px-6 py-6">
            <NumericInputKeypad disabled={busy} onKey={append} value={money(entered)} />
            {error && (
              <p className="mt-2 text-center text-base font-bold text-red-600">
                {error}
              </p>
            )}
            <div className="relative z-10 mt-4 w-[365px] self-center bg-white">
              <div
                aria-label="결제수단 선택"
                className="horizontal-select-scroll payment-method-scroll flex w-full flex-nowrap gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain bg-white px-[14px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [touch-action:pan-x]"
                {...paymentScrollHandlers}
                ref={paymentMethodsRef}
                role="group"
              >
              <button
                className="min-h-[76px] w-[104px] shrink-0 rounded-xl border border-slate-300 bg-white text-xl font-extrabold text-slate-900 ring-2 ring-inset ring-blue-600/50"
                disabled={busy || displayRemaining <= 0}
                onClick={() => pay("CARD")}
                type="button"
              >
                카드
              </button>
              <button
                className="min-h-[76px] w-[104px] shrink-0 rounded-xl border border-slate-300 bg-white text-xl font-extrabold text-slate-900 ring-2 ring-inset ring-blue-600/50"
                disabled={busy || displayRemaining <= 0}
                onClick={() => pay("CASH")}
                type="button"
              >
                현금
              </button>
              <button
                aria-label="기타결제"
                className="min-h-[76px] w-[104px] shrink-0 rounded-xl border border-slate-300 bg-white text-xl font-extrabold text-slate-900 ring-2 ring-inset ring-blue-600/50"
                disabled={busy || displayRemaining <= 0}
                onClick={() => setOtherOpen(true)}
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
            >
              결제완료
            </button>
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
      {customerSelectOpen && <CustomerSelectDialog
        selected={selectedCustomer}
        onClose={() => setCustomerSelectOpen(false)}
        onSelect={customer => { setSelectedCustomer(customer); if (customer) setCustomerSelectOpen(false); }}
      />}
      {cancelTarget && (
        <PaymentCancellationDialog
          busy={busy}
          error={cancelError}
          label={`${initialPaymentIds.includes(cancelTarget.paymentId) ? "선불" : ""}${paymentMethodLabel(cancelTarget)}`}
          payment={cancelTarget}
          close={() => {
            if (busy) return;
            setCancelError("");
            setCancelTarget(null);
          }}
          submit={() => void cancelPayment()}
        />
      )}
    </div>
  );
}

function PaymentCancellationDialog({
  payment,
  label,
  error,
  busy,
  close,
  submit,
}: {
  payment: Payment;
  label: string;
  error: string;
  busy: boolean;
  close: () => void;
  submit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
      <section
        aria-modal="true"
        className="flex min-h-[440px] w-full max-w-[461px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
      >
        <PosSubHeader backLabel="결제취소 닫기" disabled={busy} onBack={close} title="결제취소" />
        <div className="flex flex-1 flex-col px-7 pb-7 pt-6">
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto_72px] items-center gap-3 rounded-xl border border-slate-200 px-4 py-5 text-lg font-bold text-slate-900">
          <span className="truncate text-red-600">{label}</span>
          <strong className="text-xl text-red-600">{money(payment.amount)}</strong>
          <time className="text-right" dateTime={payment.paidAt}>{paymentTime(payment.paidAt)}</time>
        </div>
        <div className="mt-5 min-h-[52px] space-y-2">
          {(payment.appliedAmount < payment.amount || payment.prepaidCreditAmount > 0) && <div className="rounded-lg bg-slate-50 px-4 py-3 text-base text-slate-800">
            <div className="flex justify-between"><span>매출 적용</span><b>{money(payment.appliedAmount)}</b></div>
            {payment.prepaidCreditAmount > 0 && <div className="mt-1 flex justify-between"><span>취소할 선불 적립</span><b>{money(payment.prepaidCreditAmount)}</b></div>}
            {payment.changeAmount > 0 && <div className="mt-1 flex justify-between"><span>거스름돈</span><b>{money(payment.changeAmount)}</b></div>}
          </div>}
          {payment.methodCode === "CARD" && payment.approvalNo && (
            <div className="flex justify-between rounded-lg bg-slate-50 px-4 py-3 text-base text-slate-800">
              <span>승인번호</span>
              <b>{payment.approvalNo}</b>
            </div>
          )}
        </div>
        <div aria-live="polite" className="mt-3 min-h-[96px] text-base font-bold text-red-600">
          {error}
        </div>
        <button
          className="mt-auto min-h-[68px] w-full rounded-xl bg-blue-600 text-xl font-extrabold text-white disabled:opacity-40"
          disabled={busy}
          onClick={submit}
          type="button"
        >
          {busy ? "취소 처리 중..." : "결제취소"}
        </button>
        </div>
      </section>
    </div>
  );
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
