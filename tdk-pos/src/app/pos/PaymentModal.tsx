"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/format-money";
import AdminBackLink from "./admin/AdminBackLink";

type Discount = { label: string; amount: number; type: string };
type Payment = {
  paymentId: number;
  amount: number;
  methodCode: string;
  methodName: string;
  paidAt: string;
  approvalNo: string | null;
  note: string | null;
  receivedAmount: number;
  changeAmount: number;
};
type State = {
  gross: number;
  discounts: Discount[];
  total: number;
  paid: number;
  remaining: number;
  checkoutId: number | null;
  payments: Payment[];
  isPartyBill: boolean;
  tableNos: string[];
};
const money = (amount: number) => formatMoney(amount);
const paymentMethodLabel = (payment: Payment) => {
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
  completed: () => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Payment | null>(null);
  const [cancelError, setCancelError] = useState("");
  const [initialPaymentIds, setInitialPaymentIds] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    fetch(`/api/checkouts?tableId=${tableId}`)
      .then(async (response) => ({ response, result: (await response.json()) as { success?: boolean; message?: string } & State }))
      .then(({ response, result }) => {
        if (!active) return;
        if (!response.ok || !result.success) {
          setError(result.message ?? "결제 정보를 불러올 수 없습니다.");
          return;
        }
        setInitialPaymentIds(result.payments.map((payment) => payment.paymentId));
        setState({ gross: result.gross, discounts: result.discounts, total: result.total, paid: result.paid, remaining: result.remaining, checkoutId: result.checkoutId, payments: result.payments, isPartyBill: result.isPartyBill, tableNos: result.tableNos });
      })
      .catch(() => { if (active) setError("결제 정보를 불러올 수 없습니다."); });
    return () => { active = false; };
  }, [tableId]);
  const entered = Number(input || 0);
  const append = (key: string) => {
    if (busy) return;
    setInput((current) =>
      key === "C"
        ? ""
        : `${current}${key}`.replace(/^0+(?=\d)/, "").slice(0, 9),
    );
  };
  const request = async (body: Record<string, unknown>) => {
    if (busy) return;
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
      };
      if (!response.ok || !result.success) {
        setError(result.message ?? "결제를 처리할 수 없습니다.");
        return;
      }
      setInput("");
      if (result.completed) {
        completed();
        return;
      }
      if (result.state) setState(result.state);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };
  const pay = (methodCode: string, otherLabel?: string) =>
    void request({
      action: "PAY",
      methodCode,
      amount: entered || undefined,
      otherLabel,
    });
  const complete = () => void request({ action: "COMPLETE" });
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
    ? state.tableNos.join(" · ")
    : tableNo;
  const discountAmount = state.discounts.reduce(
    (sum, discount) => sum + discount.amount,
    0,
  );
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
      <section
        aria-modal="true"
        className="flex h-[min(760px,calc(100dvh-2rem))] w-full max-w-[782px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
      >
        <header className="flex shrink-0 items-center justify-between border-b-2 border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <AdminBackLink ariaLabel="결제창 닫기" disabled={busy} onNavigate={requestClose} title="결제창 닫기" />
            <h1 className="text-2xl font-extrabold">결제</h1>
          </div>
          <p className="flex items-end gap-2">
            <b className={`${state.isPartyBill ? "text-[45px]" : "text-7xl"} leading-none`}>{displayedTableNos}</b>
            <span className="pb-1 text-lg font-bold">테이블</span>
          </p>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[44%_56%]">
          <section className="min-h-0 overflow-y-auto border-r border-slate-200 px-6 py-6">
            <div className="space-y-[7px] pb-5 text-lg">
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
              <div className="mt-[14px] flex items-center justify-between gap-3 border-t border-slate-300 pt-[14px] text-2xl font-bold text-blue-700">
                <span>결제금액</span>
                <b className="text-4xl font-extrabold">
                  {money(state.total)}
                </b>
              </div>
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
                  {payment.methodCode === "CASH" && payment.changeAmount > 0 && (
                    <div className="flex items-center justify-between px-2 text-lg text-red-600">
                      <span>현금거스름</span>
                      <b>-{money(payment.changeAmount)}</b>
                    </div>
                  )}
                  </div>
                  );
                })}
              </div>
              <div className="mt-[17px] flex justify-between border-t border-slate-300 pt-[17px] text-2xl font-extrabold text-blue-700">
                <span>받을금액</span>
                <b>{money(state.remaining)}</b>
              </div>
            </div>
          </section>
          <section className="flex min-h-0 flex-col px-6 py-6">
            <div className="flex h-8 w-[337px] shrink-0 self-center items-center justify-between gap-3 px-1">
              <span className="text-xl font-bold text-slate-700">입력</span>
              <b className="text-4xl font-extrabold">{money(entered)}</b>
            </div>
            <div className="mt-3 flex min-h-0 flex-1 items-stretch justify-center">
              <div className="h-full w-[337px] overflow-hidden rounded-xl border border-slate-300 p-2">
              <div className="grid h-full min-h-0 grid-cols-3 grid-rows-4 gap-1">
              {[
                "7",
                "8",
                "9",
                "4",
                "5",
                "6",
                "1",
                "2",
                "3",
                "000",
                "0",
                "C",
              ].map((key) => (
                <button
                  className={`min-h-[70px] font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40 ${key === "C" ? "text-[30px]" : key === "000" ? "text-2xl" : "text-3xl"}`}
                  disabled={busy}
                  key={key}
                  onClick={() => append(key)}
                  type="button"
                >
                  {key}
                </button>
              ))}
              </div>
              </div>
            </div>
            {error && (
              <p className="mt-2 text-center text-base font-bold text-red-600">
                {error}
              </p>
            )}
            <div className="relative z-10 mt-4 grid w-[337px] self-center grid-cols-3 gap-3 bg-white">
              <button
                className="min-h-[76px] rounded-xl border border-slate-300 bg-white text-xl font-extrabold text-slate-900 ring-2 ring-blue-600/50 disabled:opacity-40"
                disabled={busy || state.remaining <= 0}
                onClick={() => pay("CARD")}
                type="button"
              >
                카드
              </button>
              <button
                className="min-h-[76px] rounded-xl border border-slate-300 bg-white text-xl font-extrabold text-slate-900 ring-2 ring-blue-600/50"
                disabled={busy || state.remaining <= 0}
                onClick={() => pay("CASH")}
                type="button"
              >
                현금
              </button>
              <button
                aria-label="기타결재"
                className="min-h-[76px] rounded-xl border border-slate-300 bg-white text-xl font-extrabold text-slate-900 ring-2 ring-blue-600/50"
                disabled={busy || state.remaining <= 0}
                onClick={() => setOtherOpen(true)}
                type="button"
              >
                기타결재
              </button>
            </div>
            <button
              className="mt-3 min-h-[72px] w-[337px] self-center rounded-xl bg-blue-600 text-xl font-extrabold text-white disabled:bg-slate-200 disabled:text-slate-400"
              disabled={busy || state.remaining > 0}
              onClick={complete}
              type="button"
            >
              결제완료
            </button>
          </section>
        </div>
      </section>
      {otherOpen && (
        <Dialog title="기타 결제">
          <div className="grid grid-cols-2 gap-3">
            {[
              ["TRANSFER", "이체"],
              ["MEAL_TICKET", "후불식권"],
              ["GIFT", "상품권"],
              ["OTHER", "식권"],
              ["OTHER", "기타결제"],
            ].map(([code, label]) => (
              <button
                className="min-h-16 rounded-xl border text-lg font-bold"
                key={label}
                onClick={() => {
                  setOtherOpen(false);
                  pay(code, label);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </Dialog>
      )}
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
        className="flex min-h-[440px] w-full max-w-[461px] flex-col rounded-2xl bg-white p-7 shadow-2xl"
        role="dialog"
      >
        <header className="flex items-center gap-3 border-b border-slate-200 pb-5">
          <AdminBackLink ariaLabel="결제취소 닫기" disabled={busy} onNavigate={close} title="결제취소 닫기" />
          <h2 className="text-2xl font-extrabold text-slate-900">결제취소</h2>
        </header>
        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto_72px] items-center gap-3 rounded-xl border border-slate-200 px-4 py-5 text-lg font-bold text-slate-900">
          <span className="truncate text-red-600">{label}</span>
          <strong className="text-xl text-red-600">{money(payment.amount)}</strong>
          <time className="text-right" dateTime={payment.paidAt}>{paymentTime(payment.paidAt)}</time>
        </div>
        <div className="mt-5 min-h-[52px]">
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
      </section>
    </div>
  );
}

function Dialog({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4">
      <section
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-white p-7 shadow-2xl"
        role="dialog"
      >
        <h2 className="text-center text-2xl font-extrabold">{title}</h2>
        <div className="mt-6">{children}</div>
      </section>
    </div>
  );
}
