"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import { useHorizontalScroll } from "@/hooks/useHorizontalScroll";
import { formatMoney } from "@/lib/format-money";
import { createRequestId } from "@/lib/request-id";
import { printReceipt } from "@/lib/receipt-print";
import { prepareAccountTransferNotice, printAccountTransferNotice } from "@/lib/account-transfer-notice";
import { buildPartyOrderRows, type PartySummarySourceItem } from "@/lib/pos-order-summary-rows";
import OtherPaymentDialog from "./OtherPaymentDialog";
import CustomerSelectDialog, { type SelectedCustomer } from "./CustomerSelectDialog";
import PosSubHeader from "./PosSubHeader";
import { POS_HEADER_ACTION_CLASS_NAME } from "./pos-header-action";
import { ORDER_INFO_SCROLL_BOX_CLASS_NAME, ORDER_INFO_STYLES } from "./order-info-styles";
import OrderSummaryRows from "./OrderSummaryRows";

type Discount = { sessionId: number; label: string; amount: number; type: string };
type Payment = {
  paymentId: number;
  amount: number;
  appliedAmount: number;
  prepaidCreditAmount: number;
  customerId: number | null;
  customerName: string | null;
  customerBalanceAfterPayment: number | null;
  methodCode: string;
  accountInfoEnabled: number | null;
  methodName: string;
  paidAt: string;
  approvalNo: string | null;
  note: string | null;
  methodNameSnapshot: string | null;
  quantity: number | null;
  customerCouponQuantity: number | null;
  receivedAmount: number;
  changeAmount: number;
  autoCompleteEnabled: boolean;
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
  sessionIds: number[];
};
type SaleOrder = { orderId: number; sessionId: number; status: string; items: Omit<PartySummarySourceItem, "orderId" | "sessionId">[] };
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
type AvailableReceiptType = "GENERAL" | "SIGN" | "BANK_TRANSFER_GUIDE";
const money = (amount: number) => formatMoney(amount);
const newCustomerPaymentRequestKey = createRequestId;
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
const paymentInfoLabelStyle = "text-[20px] font-normal";
const paymentInfoAmountStyle = "text-[20px] font-bold";
const paymentInfoSmallLabelStyle = "text-[20px] font-normal";
const paymentInfoSmallAmountStyle = "text-[20px] font-bold";
const paymentInfoRowStyle = "flex justify-between leading-7";
const paymentFooterButtonStyle = "min-h-[72px] w-full rounded-lg border border-slate-300 bg-white text-lg font-bold text-slate-900 transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40";
export default function PaymentModal({
  tableId,
  sessionId,
  tableNo,
  orderDetails,
  renderOrderDetails,
  selectedCustomer,
  onSelectCustomer,
  close,
  completed,
  onCashPaymentRegistered,
  onBusinessOpeningRequired,
  onPrintReceipt,
  receiptPrinting,
}: {
  tableId: number;
  sessionId?: number;
  tableNo: string;
  orderDetails: SaleOrder[];
  renderOrderDetails: (sessionIds: number[]) => ReactNode;
  selectedCustomer: SelectedCustomer | null;
  onSelectCustomer: (customer: SelectedCustomer | null) => void;
  close: () => void;
  completed: () => void;
  onCashPaymentRegistered: () => void;
  onBusinessOpeningRequired: (retry: () => void) => void;
  onPrintReceipt: (checkoutId?: number, isReprint?: boolean) => Promise<void>;
  receiptPrinting: boolean;
}) {
  const [state, setState] = useState<State | null>(null);
  const [orderTab, setOrderTab] = useState<"summary" | "detail">("summary");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const requestInFlight = useRef(false);
  const requestRetryRef = useRef<((body: Record<string, unknown>, afterRegistered?: () => void) => Promise<{ ok: boolean; message?: string }>) | null>(null);
  const autoPrintAttempted = useRef(new Set<string>());
  const autoCustomerPaymentRequested = useRef<string | null>(null);
  const [transactionCompleted, setTransactionCompleted] = useState(false);
  const [hasPaymentAction, setHasPaymentAction] = useState(false);
  const [lastPaymentAutoCompleteEnabled, setLastPaymentAutoCompleteEnabled] = useState(true);
  const [autoCompleteSeconds, setAutoCompleteSeconds] = useState<number | null>(null);
  const [completedAtMs, setCompletedAtMs] = useState<number | null>(null);
  const [secondsUntilClose, setSecondsUntilClose] = useState<number | null>(null);
  const closingRef = useRef(false);
  const completionPausedRef = useRef(false);
  const completeRef = useRef<() => void>(() => {});
  const [completedCheckoutIds, setCompletedCheckoutIds] = useState<number[]>([]);
  const [autoPrintPending, setAutoPrintPending] = useState(false);
  const [receiptChooserOpen, setReceiptChooserOpen] = useState(false);
  const [signReceiptPrinting, setSignReceiptPrinting] = useState(false);
  const [transferNoticePrinting, setTransferNoticePrinting] = useState(false);
  const [error, setError] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const [stagedCustomerPayment, setStagedCustomerPayment] = useState<StagedCustomerPayment | null>(null);
  const [customerSelectOpen, setCustomerSelectOpen] = useState(false);
  const [deletionTarget, setDeletionTarget] = useState<PaymentDeletionTarget | null>(null);
  const [cancelError, setCancelError] = useState("");
  const [resetPaymentsConfirm, setResetPaymentsConfirm] = useState(false);
  const [overpaymentPrompt, setOverpaymentPrompt] = useState<OverpaymentPrompt | null>(null);
  const [cardErrorDialog, setCardErrorDialog] = useState<{ message: string; resetInputOnClose?: boolean } | null>(null);
  const [initialPaymentIds, setInitialPaymentIds] = useState<number[]>([]);
  const { ref: paymentMethodsRef, hints: scrollHints, handlers: paymentScrollHandlers } = useHorizontalScroll(state !== null);
  useEffect(() => {
    let active = true;
    fetch(sessionId ? `/api/checkouts?sessionId=${sessionId}` : `/api/checkouts?tableId=${tableId}`)
      .then(async (response) => ({ response, result: (await response.json()) as { success?: boolean; message?: string; settled?: boolean; checkoutIds?: number[] } & State }))
      .then(({ response, result }) => {
        if (!active) return;
        if (!response.ok || !result.success) {
        }
        setInitialPaymentIds(result.payments.map((payment) => payment.paymentId));
        setState({ gross: result.gross, discounts: result.discounts, total: result.total, paid: result.paid, remaining: result.remaining, prepaidCredit: result.prepaidCredit ?? 0, checkoutId: result.checkoutId, payments: result.payments, isPartyBill: result.isPartyBill, tableNos: result.tableNos, sessionIds: result.sessionIds });
        if (result.settled) {
          const checkoutIds = result.checkoutIds ?? [];
          setCompletedCheckoutIds(checkoutIds);
          setTransactionCompleted(true);
          autoPrintAttempted.current.add(checkoutIds.join(","));
        }
      })
      .catch(() => { if (active) setError("결제 정보를 불러올 수 없습니다."); });
    return () => { active = false; };
  }, [tableId, sessionId]);
  useEffect(() => {
    let active = true;
    fetch("/api/pos-settings/payment-auto-complete", { cache: "no-store" })
      .then(async response => {
        const result = await response.json() as { success?: boolean; seconds?: number };
        if (!response.ok || !result.success || !Number.isSafeInteger(result.seconds) || (result.seconds ?? -1) < 0) {
          throw new Error("결제창 자동 완료 설정을 불러오지 못했습니다.");
        }
        if (active) setAutoCompleteSeconds(result.seconds!);
      })
      .catch(error => {
        console.error("Payment auto-complete setting load failed", error);
        if (active) setAutoCompleteSeconds(0);
      });
    return () => { active = false; };
  }, []);
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
  const printCompletedReceipts = useCallback(async (checkoutIds: number[], isReprint: boolean) => {
    if (!checkoutIds.length) {
      await onPrintReceipt();
      return;
    }
    for (const checkoutId of checkoutIds) await onPrintReceipt(checkoutId, isReprint);
  }, [onPrintReceipt]);
  const request = useCallback(async (body: Record<string, unknown>, afterRegistered?: () => void): Promise<{ ok: boolean; message?: string }> => {
    if (requestInFlight.current || transactionCompleted) return { ok: false };
    requestInFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(sessionId ? { sessionId } : { tableId }), ...body }),
      });
      const result = (await response.json()) as {
        success?: boolean;
        message?: string;
        completed?: boolean;
        change?: number;
        tendered?: number;
        state?: State;
        completedCheckoutIds?: number[];
        completedPayments?: State["payments"];
        accountTransferPaymentId?: number | null;
        customerPaymentId?: number | null;
        autoPrintSignReceipt?: boolean;
        autoCompleteEnabled?: boolean;
        debugPhase?: string;
        debugMessage?: string;
        openingRequired?: boolean;
      };
      if (response.status === 428 && result.openingRequired) {
        onBusinessOpeningRequired(() => { void requestRetryRef.current?.(body, afterRegistered); });
        return { ok: false, message: result.message };
      }
      if (!response.ok || !result.success) {
        const message = result.message ?? "결제를 처리하지 못했습니다.";
        if (result.debugPhase || result.debugMessage) {
          console.error("[checkout] payment request failed", { status: response.status, action: body.action, phase: result.debugPhase, serverError: result.debugMessage });
        }
        setError(message);
        return { ok: false, message };
      }
      setInput("");
      if (afterRegistered || (body.action === "PAY_CUSTOMER" && (result.change ?? 0) > 0)) {
        onCashPaymentRegistered();
      }
      if (body.action === "PAY" || body.action === "PAY_OTHER" || body.action === "PAY_CUSTOMER") {
        setHasPaymentAction(true);
        setLastPaymentAutoCompleteEnabled(result.autoCompleteEnabled !== false);
      }
      if (Number.isSafeInteger(result.accountTransferPaymentId) && Number(result.accountTransferPaymentId) > 0) {
        void (async () => {
          try {
            const notice = await prepareAccountTransferNotice({ mode: "LIVE", paymentId: result.accountTransferPaymentId! });
            await printAccountTransferNotice(notice);
          } catch (printError) {
            console.error("Account transfer notice print failed", printError);
            setError(printError instanceof Error ? printError.message : "계좌이체 안내서 출력에 실패했습니다.");
          }
        })();
      }
      const customerReceiptPrint = body.action === "PAY_CUSTOMER" && result.autoPrintSignReceipt === true && Number.isSafeInteger(result.customerPaymentId) && Number(result.customerPaymentId) > 0
        ? printReceipt({ customerPaymentId: result.customerPaymentId! }).catch(printError => {
          console.error("Customer payment confirmation receipt print failed", printError);
          setError(printError instanceof Error ? printError.message : "고객 선불금 결제 영수증을 출력하지 못했습니다.");
        })
        : Promise.resolve();
      if (result.completed) {
        const checkoutIds = result.completedCheckoutIds ?? [];
        setCompletedCheckoutIds(checkoutIds);
        setCompletedAtMs(Date.now());
        setTransactionCompleted(true);
        setStagedCustomerPayment(null);
        setState(current => current ? {
          ...current,
          paid: current.total,
          remaining: 0,
          checkoutId: checkoutIds[0] ?? current.checkoutId,
          payments: result.completedPayments ?? current.payments,
        } : current);
        const key = checkoutIds.join(",");
        if (key && !autoPrintAttempted.current.has(key)) {
          autoPrintAttempted.current.add(key);
          setAutoPrintPending(true);
          void (async () => {
            try {
              const settingResponse = await fetch("/api/pos-settings/receipt-auto-print", { cache: "no-store" });
              const setting = await settingResponse.json() as { success?: boolean; enabled?: boolean };
              if (!settingResponse.ok || !setting.success) throw new Error("자동 영수증 인쇄 설정을 확인하지 못했습니다.");
              if (setting.enabled) {
                await customerReceiptPrint;
                await printCompletedReceipts(checkoutIds, false);
              }
            } catch (printError) {
              setError(printError instanceof Error ? printError.message : "자동 영수증 출력에 실패했습니다.");
            } finally {
              setAutoPrintPending(false);
            }
          })();
        }
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
  }, [tableId, sessionId, transactionCompleted, onCashPaymentRegistered, onBusinessOpeningRequired, printCompletedReceipts]);
  useEffect(() => { requestRetryRef.current = request; }, [request]);
  useEffect(() => {
    if (!stagedCustomerPayment || !state || transactionCompleted || busy || requestInFlight.current) return;
    if (stagedCustomerPayment.amount < state.remaining || autoCustomerPaymentRequested.current === stagedCustomerPayment.requestKey) return;
    autoCustomerPaymentRequested.current = stagedCustomerPayment.requestKey;
    void request({
      action: "PAY_CUSTOMER",
      customerId: stagedCustomerPayment.customerId,
      amount: stagedCustomerPayment.amount,
      requestKey: stagedCustomerPayment.requestKey,
      couponQuantity: stagedCustomerPayment.couponQuantity,
    });
  }, [stagedCustomerPayment, state, transactionCompleted, busy, request]);
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
      setCardErrorDialog({ message: "카드 결제금액이 받을금액보다 많습니다." });
      return;
    }
    const body = { ...overpaymentPrompt.requestBody, prepaidOverpaymentConfirmed: confirmed };
    await request(body, overpaymentPrompt.kind === "CASH" ? onCashPaymentRegistered : undefined);
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
    return request(requestBody, cashChangeEnabled ? onCashPaymentRegistered : undefined);
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
      setCardErrorDialog({ message: "받을 금액이 없습니다." });
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
          setCardErrorDialog({ message: `받을금액 ${money(state.remaining)}원보다\n카드 결제금액이 많습니다.`, resetInputOnClose: true });
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
    void request(
      { action: "PAY", methodCode, amount: amount || undefined, customerId: selectedCustomer?.customerId, otherLabel },
      methodCode === "CASH" ? onCashPaymentRegistered : undefined,
    );
  };
  const complete = async () => {
    if (!transactionCompleted || state?.remaining !== 0 || closingRef.current || completionPausedRef.current || busy) return;
    closingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(sessionId ? { sessionId } : { tableId }), action: "COMPLETE" }),
      });
      const result = await response.json() as { success?: boolean; message?: string; openingRequired?: boolean };
      if (response.status === 428 && result.openingRequired) {
        closingRef.current = false;
        setBusy(false);
        onBusinessOpeningRequired(() => { void complete(); });
        return;
      }
      if (!response.ok || !result.success) throw new Error(result.message ?? "결제를 완료하지 못했습니다.");
      completed();
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "결제를 완료하지 못했습니다.");
      closingRef.current = false;
      if (hasPaymentAction) setCompletedAtMs(Date.now());
      setBusy(false);
    }
  };
  const clearCompletionCountdown = () => {
    if (completedCheckoutIds.length) autoPrintAttempted.current.delete(completedCheckoutIds.join(","));
    setTransactionCompleted(false);
    setHasPaymentAction(false);
    setLastPaymentAutoCompleteEnabled(true);
    setCompletedAtMs(null);
    setSecondsUntilClose(null);
    setCompletedCheckoutIds([]);
    closingRef.current = false;
    completionPausedRef.current = false;
  };
  useEffect(() => { completeRef.current = complete; });
  useEffect(() => {
    if (!hasPaymentAction || !lastPaymentAutoCompleteEnabled || !transactionCompleted || state?.remaining !== 0 || completedAtMs === null || autoCompleteSeconds === null || autoCompleteSeconds === 0) {
      return;
    }
    const deadline = completedAtMs + autoCompleteSeconds * 1000;
    const tick = () => {
      if (completionPausedRef.current || busy) return;
      const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (secondsLeft === 0) {
        window.clearInterval(interval);
        completeRef.current();
        return;
      }
      setSecondsUntilClose(secondsLeft);
    };
    const interval = window.setInterval(tick, 250);
    tick();
    return () => {
      window.clearInterval(interval);
    };
  }, [hasPaymentAction, lastPaymentAutoCompleteEnabled, transactionCompleted, state?.remaining, completedAtMs, autoCompleteSeconds, busy]);
  const cancelPayment = async () => {
    if (!deletionTarget || busy) return;
    if (deletionTarget.kind === "STAGED_CUSTOMER") {
      setStagedCustomerPayment(null);
      setDeletionTarget(null);
      completionPausedRef.current = false;
      return;
    }
    completionPausedRef.current = true;
    setBusy(true);
    setCancelError("");
    try {
      const response = await fetch("/api/checkouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(sessionId ? { sessionId } : { tableId }), action: "CANCEL_PAYMENT", paymentId: deletionTarget.payment.paymentId }),
      });
      const result = (await response.json()) as { success?: boolean; message?: string; state?: State };
      if (!response.ok || !result.success || !result.state) {
        setCancelError(result.message ?? "결제를 취소할 수 없습니다.");
        return;
      }
      setState(result.state);
      if (result.state.remaining > 0) clearCompletionCountdown();
      else {
        setLastPaymentAutoCompleteEnabled(result.state.payments.at(-1)?.autoCompleteEnabled !== false);
        completionPausedRef.current = false;
        if (hasPaymentAction) setCompletedAtMs(Date.now());
      }
      setDeletionTarget(null);
    } catch {
      setCancelError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };
  const resetPayments = async (showDialogOnError = false) => {
    if (!state || busy) return;
    const paymentIds = state.payments.map(payment => payment.paymentId);
    completionPausedRef.current = true;
    setSecondsUntilClose(null);
    setBusy(true);
    requestInFlight.current = true;
    setCancelError("");
    try {
      let refreshedState = state;
      for (const paymentId of paymentIds) {
        const response = await fetch("/api/checkouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(sessionId ? { sessionId } : { tableId }), action: "CANCEL_PAYMENT", paymentId }),
        });
        const result = await response.json() as { success?: boolean; message?: string; state?: State };
        if (!response.ok || !result.success || !result.state) throw new Error(result.message ?? "결제를 초기화할 수 없습니다.");
        refreshedState = result.state;
        setState(refreshedState);
      }
      setStagedCustomerPayment(null);
      setLastPaymentAutoCompleteEnabled(refreshedState.payments.at(-1)?.autoCompleteEnabled !== false);
      if (refreshedState.remaining > 0) clearCompletionCountdown();
      else {
        completionPausedRef.current = false;
        if (hasPaymentAction) setCompletedAtMs(Date.now());
      }
      setInput("");
      setResetPaymentsConfirm(false);
    } catch (resetError) {
      setCancelError(resetError instanceof Error ? resetError.message : "결제 초기화 중 오류가 발생했습니다.");
      if (showDialogOnError) setResetPaymentsConfirm(true);
      try {
        const response = await fetch(sessionId ? `/api/checkouts?sessionId=${sessionId}` : `/api/checkouts?tableId=${tableId}`);
        const refreshed = await response.json() as { success?: boolean } & State;
        if (response.ok && refreshed.success) {
          setState(refreshed);
          if (refreshed.remaining > 0) clearCompletionCountdown();
        }
      } catch {
        // Keep the last successfully refreshed payment state visible.
      }
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };
  const openPaymentResetConfirm = () => {
    setCancelError("");
    completionPausedRef.current = true;
    setSecondsUntilClose(null);
    setResetPaymentsConfirm(true);
  };
  // Payment registration is already persisted. Leaving the modal keeps the
  // open table session and approved payments so checkout can resume later.
  const requestClose = () => {
    completionPausedRef.current = true;
    setCompletedAtMs(null);
    setSecondsUntilClose(null);
    close();
  };
  if (!state)
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55">
        <div className="rounded-2xl bg-white px-8 py-6 text-xl font-bold">
          결제 정보를 불러오는 중...
        </div>
      </div>
    );
  const displayedTableNos = state.isPartyBill && state.tableNos.length > 1
    ? state.tableNos
    : [tableNo];
  const orderedPayments = state.payments.slice().sort(
    (left, right) => Date.parse(left.paidAt) - Date.parse(right.paidAt) || left.paymentId - right.paymentId,
  );
  const signReceiptPayments = orderedPayments.filter(payment => payment.methodCode === "CUSTOMER_PAYMENT" && payment.customerCouponQuantity === null);
  const transferNoticePayments = orderedPayments.filter(payment => payment.accountInfoEnabled === 1);
  const availableReceiptTypes: AvailableReceiptType[] = orderedPayments.length > 0
    ? ["GENERAL", ...(signReceiptPayments.length > 0 ? ["SIGN" as const] : []), ...(transferNoticePayments.length > 0 ? ["BANK_TRANSFER_GUIDE" as const] : [])]
    : [];
  const receiptCheckoutIds = completedCheckoutIds.length > 0 ? completedCheckoutIds : state.checkoutId ? [state.checkoutId] : [];
  const printGeneralReceipt = () => printCompletedReceipts(receiptCheckoutIds, true);
  const handleReceiptClick = () => {
    if (availableReceiptTypes.length === 0) return;
    if (availableReceiptTypes.length > 1) {
      setReceiptChooserOpen(true);
      return;
    }
    void printGeneralReceipt();
  };
  const printSignReceipt = async (paymentId: number) => {
    if (!signReceiptPayments.some(payment => payment.paymentId === paymentId) || signReceiptPrinting) return;
    setReceiptChooserOpen(false);
    setSignReceiptPrinting(true);
    setError("");
    try {
      await printReceipt({ customerPaymentId: paymentId });
    } catch (printError) {
      console.error("Manual customer sign receipt print failed", printError);
      setError(printError instanceof Error ? printError.message : "증빙용영수증을 출력하지 못했습니다.");
    } finally {
      setSignReceiptPrinting(false);
    }
  };
  const printTransferNotice = async (paymentId: number) => {
    if (!transferNoticePayments.some(payment => payment.paymentId === paymentId) || transferNoticePrinting) return;
    setReceiptChooserOpen(false);
    setTransferNoticePrinting(true);
    setError("");
    try {
      const notice = await prepareAccountTransferNotice({ mode: "MANUAL", paymentId });
      await printAccountTransferNotice(notice);
    } catch (printError) {
      console.error("Manual account transfer notice print failed", printError);
      setError(printError instanceof Error ? printError.message : "계좌이체 안내 출력에 실패했습니다.");
    } finally {
      setTransferNoticePrinting(false);
    }
  };
  const billSessionIds = new Set(state.sessionIds);
  const billRows = buildPartyOrderRows(orderDetails
    .filter(order => billSessionIds.has(order.sessionId) && order.status !== "CANCELLED")
    .flatMap(order => order.items.map(item => ({ ...item, orderId: order.orderId, sessionId: order.sessionId }))),
    state.discounts.map(discount => ({
      sessionId: discount.sessionId,
      discountType: discount.type,
      label: discount.label,
      discountAmount: String(discount.amount),
      discountRate: null,
    })));
  const discountTotal = state.discounts.reduce(
    (sum, discount) => sum + Math.max(0, discount.amount),
    0,
  );
  const hasDiscount = discountTotal > 0;
  const renderOrderAmountSummary = () => (
    <div className="mt-3">
      {hasDiscount && <>
        <div className="flex justify-between border-t border-blue-200 pt-3 text-base font-bold text-slate-700">
          <span>주문금액</span><b>{money(state.gross)}</b>
        </div>
        <div className="mt-2 flex justify-between text-sm text-slate-900">
          <span>할인금액</span><b className="text-red-600">- {money(discountTotal)}</b>
        </div>
      </>}
      <div className={`flex justify-between border-t border-blue-200 pt-3 text-base font-bold text-slate-900 ${hasDiscount ? "mt-3" : ""}`}>
        <span>받을금액</span><b className="text-lg font-extrabold text-blue-700">{money(state.total)}</b>
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
      <section
        aria-modal="true"
        className="flex max-h-[calc(100dvh-32px)] w-[988px] shrink-0 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        role="dialog"
      >
        <PosSubHeader backLabel="결제창 닫기" disabled={busy} level={1} onBack={requestClose} title="결제" trailing={<button className={POS_HEADER_ACTION_CLASS_NAME} disabled={busy || transactionCompleted} onClick={() => setCustomerSelectOpen(true)} title={selectedCustomer?.name ?? "고객"} type="button">{selectedCustomer?.name ? `${selectedCustomer.name} ⋮` : "고객 ⋮"}</button>} />
        <div className="grid min-h-0 grid-cols-[350px_minmax(0,1fr)_320px]">
          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-slate-200 bg-white [contain:size]">
            <div className="shrink-0 px-2.5 pt-4">
              <nav aria-label="결제 주문 정보" className="grid grid-cols-2 gap-0 rounded-xl bg-slate-100 p-0">
                {([["summary", "주문집계"], ["detail", "주문상세"]] as const).map(([key, label]) => (
                  <button
                    className={`relative overflow-hidden rounded-lg py-2 text-[10px] font-bold ${orderTab === key ? `${ORDER_INFO_STYLES[key].bg} text-white` : "border border-slate-200 bg-white text-slate-500"}`}
                    key={key}
                    onClick={() => setOrderTab(key)}
                    type="button"
                  >
                    <i className="absolute left-0 top-0 size-3 brightness-75 [clip-path:polygon(0_0,100%_0,0_100%)]" style={{ backgroundColor: ORDER_INFO_STYLES[key].color }} />
                    {label}
                  </button>
                ))}
              </nav>
              <div className={`mt-1.5 h-[3px] ${ORDER_INFO_STYLES[orderTab].bg}`} />
            </div>
            <div className={`${ORDER_INFO_SCROLL_BOX_CLASS_NAME} mx-2.5 mb-3 rounded-b-xl border-t-0`} style={{ backgroundColor: ORDER_INFO_STYLES[orderTab].tint }}>
              <div className="shrink-0 border-b border-slate-200 py-1 text-[27px] font-bold text-slate-900">{displayedTableNos.join(". ")}{sessionId ? "" : "T"}</div>
              <div className="mt-3 grid grid-cols-[1fr_52px_76px_58px] border-b border-slate-200 pb-2 text-[11px] font-bold text-slate-500">
                <span>메뉴명</span>
                <span className="text-right">단가</span>
                <span className="text-center">수량</span>
                <span className="text-right">금액</span>
              </div>
              <div>
                {orderTab === "summary" ? (
                  <div className="py-3">
                    {billRows.length ? <OrderSummaryRows items={billRows} /> : <p className="py-6 text-center text-sm text-slate-400">현재 주문 내역이 없습니다.</p>}
                    {renderOrderAmountSummary()}
                  </div>
                ) : (
                  <div className="py-2">
                    {renderOrderDetails(state.sessionIds)}
                    {renderOrderAmountSummary()}
                  </div>
                )}
              </div>
            </div>
          </section>
          <section className="flex min-h-0 flex-col border-r border-slate-200 px-[18px] py-6" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 pt-2 text-center">
                <div className="text-base font-medium text-slate-700">총 결제금액</div>
                <div className="mt-1 text-[30px] font-bold leading-tight text-blue-700">{money(state.total)}원</div>
              </div>
              {(state.payments.length > 0 || stagedCustomerPayment) && (
                <div className="mt-8 flex min-h-0 flex-1 flex-col px-3">
                  <div className="min-h-0 overflow-y-auto overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [touch-action:pan-y]">
                {orderedPayments.map(payment => {
                  const prepaid = initialPaymentIds.includes(payment.paymentId);
                  return (
                    <Fragment key={payment.paymentId}>
                      <button
                        aria-label={`${prepaid ? "선불" : ""}${paymentMethodLabel(payment)} ${money(payment.receivedAmount)} 결제내역 삭제`}
                        className="flex w-full flex-col py-3 text-left text-slate-900"
                        disabled={busy}
                        onClick={() => {
                          completionPausedRef.current = true;
                          setSecondsUntilClose(null);
                          setCancelError("");
                          setDeletionTarget({ kind: "SAVED", payment });
                        }}
                        type="button"
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className={`min-w-0 truncate ${prepaid ? paymentInfoSmallLabelStyle : paymentInfoLabelStyle}`}>
                            {prepaid ? "선불" : ""}{paymentMethodLabel(payment)}
                          </span>
                          <b className={`shrink-0 ${paymentInfoAmountStyle}`}>{money(payment.receivedAmount)}</b>
                        </div>
                        {payment.methodCode === "CUSTOMER_PAYMENT" && payment.customerName && payment.customerBalanceAfterPayment !== null && (
                          <div className="mt-0.5 flex min-w-0 items-center whitespace-nowrap text-sm font-normal leading-5 text-slate-500">
                            <span className="shrink-0">(</span>
                            <span className="min-w-0 truncate">{payment.customerName}</span>
                            <span className="shrink-0 whitespace-pre"> 결제 후 </span>
                            <span className="ml-auto shrink-0 whitespace-nowrap">{money(payment.customerBalanceAfterPayment)})</span>
                          </div>
                        )}
                      </button>
                      {payment.changeAmount > 0 && (
                        <div className={`${paymentInfoRowStyle} items-center py-3 text-slate-900`}>
                          <span className={prepaid ? paymentInfoSmallLabelStyle : paymentInfoLabelStyle}>{payment.methodCode === "CASH" || payment.methodNameSnapshot ? "현금 거스름" : "거스름돈"}</span>
                          <b className={`${paymentInfoAmountStyle} ${payment.methodCode === "CASH" || payment.methodNameSnapshot ? "text-blue-600" : ""}`}>-{money(payment.changeAmount)}</b>
                        </div>
                      )}
                      {payment.prepaidCreditAmount > 0 && (
                        <div className={`${paymentInfoRowStyle} items-center py-3 text-slate-900`}>
                          <span className={paymentInfoSmallLabelStyle}>선불 적립</span>
                          <b className={paymentInfoSmallAmountStyle}>{money(payment.prepaidCreditAmount)}</b>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
                {stagedCustomerPayment && (
                  <button
                    aria-label={`${stagedCustomerPayment.name} 고객결제 예정 내역 삭제`}
                    className={`${paymentInfoRowStyle} w-full items-center py-3 text-left text-slate-900`}
                    disabled={busy || transactionCompleted}
                    onClick={() => { setCancelError(""); setDeletionTarget({ kind: "STAGED_CUSTOMER" }); }}
                    type="button"
                  >
                    <span className={`min-w-0 truncate ${paymentInfoLabelStyle}`}>{stagedCustomerPayment.name}{stagedCustomerPayment.couponQuantity ? ` · 쿠폰 ${stagedCustomerPayment.couponQuantity}매` : ""}</span>
                    <b className={`shrink-0 ${paymentInfoAmountStyle}`}>{money(stagedCustomerPayment.amount)}</b>
                  </button>
                )}
                  </div>
                  <div className={`${paymentInfoRowStyle} shrink-0 items-center border-t border-slate-200 py-3 text-[20px] leading-7`}>
                  <span className="font-semibold text-slate-900">{displayOverpayment > 0 ? "초과결제" : "남은금액"}</span>
                  <b className={`${paymentInfoSmallAmountStyle} ${displayOverpayment > 0 ? "text-red-600" : "text-blue-700"}`}>{money(displayOverpayment > 0 ? displayOverpayment : displayRemaining)}</b>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-3 grid w-full shrink-0 grid-cols-2 gap-2">
              <button
                className={paymentFooterButtonStyle}
                disabled={busy || (!state.payments.length && !stagedCustomerPayment)}
                onClick={openPaymentResetConfirm}
                type="button"
              >결제 초기화</button>
              <button
                className={paymentFooterButtonStyle}
                disabled={availableReceiptTypes.length === 0 || busy || receiptPrinting || autoPrintPending || signReceiptPrinting || transferNoticePrinting}
                onClick={handleReceiptClick}
                type="button"
              >{availableReceiptTypes.length > 0 ? `영수증(${availableReceiptTypes.length})` : "영수증"}</button>
            </div>
          </section>
          {receiptChooserOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setReceiptChooserOpen(false)}>
            <section aria-labelledby="receipt-chooser-title" aria-modal="true" className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-xl" onClick={event => event.stopPropagation()} role="dialog">
              <PosSubHeader backLabel="영수증 선택 닫기" onBack={() => setReceiptChooserOpen(false)} title="출력 영수증 선택" titleId="receipt-chooser-title" />
              <div className="grid grid-cols-2 gap-3 p-5">
                {availableReceiptTypes.includes("GENERAL") && <button className={`${paymentFooterButtonStyle} h-full min-w-0 px-3`} onClick={() => { setReceiptChooserOpen(false); void printGeneralReceipt(); }} type="button">영수증</button>}
                {availableReceiptTypes.includes("SIGN") && signReceiptPayments.map(payment => <button className={`${paymentFooterButtonStyle} h-full min-w-0 px-3`} key={payment.paymentId} onClick={() => void printSignReceipt(payment.paymentId)} type="button">증빙용 영수증{signReceiptPayments.length > 1 ? ` · ${payment.customerName ?? payment.paymentId}` : ""}</button>)}
                {availableReceiptTypes.includes("BANK_TRANSFER_GUIDE") && transferNoticePayments.map((payment, index) => <button className={`${paymentFooterButtonStyle} h-full min-w-0 px-3 ${signReceiptPayments.length + transferNoticePayments.length === 2 && index === transferNoticePayments.length - 1 ? "col-span-2" : ""}`} key={payment.paymentId} onClick={() => void printTransferNotice(payment.paymentId)} type="button">계좌이체 안내{transferNoticePayments.length > 1 ? ` · ${payment.methodName}` : ""}</button>)}
              </div>
            </section>
          </div>}
          <section className="flex min-h-0 flex-col px-4 pt-6 pb-4">
            <NumericInputKeypad className="h-[395.25px]" disabled={busy || transactionCompleted} inputEdgeToEdge inputLabel="" inputOffset={-2} onKey={append} scale={0.85} value={money(entered)} />
            {error && <p className="mt-2 text-center text-base font-bold text-red-600">{error}</p>}
            <div className="relative z-10 mt-4 w-[286.45px] max-w-full self-center bg-white">
              <div
                aria-label="결제수단 선택"
                className="horizontal-select-scroll payment-method-scroll flex w-full flex-nowrap gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain bg-white [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [touch-action:pan-x]"
                {...paymentScrollHandlers}
                ref={paymentMethodsRef}
                role="group"
              >
              <button
                className="min-h-[76px] min-w-0 w-auto flex-1 shrink-0 rounded-xl border border-[#D5DCE5] bg-white text-lg font-bold text-slate-900 transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D5DCE5]"
                disabled={busy || transactionCompleted}
                onClick={() => pay("CARD")}
                type="button"
              >
                카드
              </button>
              <button
                className="min-h-[76px] min-w-0 w-auto flex-1 shrink-0 rounded-xl border border-[#D5DCE5] bg-white text-lg font-bold text-slate-900 transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D5DCE5]"
                disabled={busy || transactionCompleted}
                onClick={() => pay("CASH")}
                type="button"
              >
                현금
              </button>
              <button
                aria-label="기타"
                className="min-h-[76px] min-w-0 w-auto flex-1 shrink-0 rounded-xl border border-[#D5DCE5] bg-white text-lg font-bold text-slate-900 transition-colors hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D5DCE5]"
                disabled={busy || transactionCompleted}
                onClick={() => { if (displayRemaining <= 0) { setError(""); setCardErrorDialog({ message: "받을 금액이 없습니다." }); return; } setError(""); setOtherOpen(true); }}
                type="button"
              >
                기타
              </button>
              </div>
              {scrollHints.left && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex w-[14px] items-center justify-center text-[32px] leading-none text-slate-500">⋮</span>
              )}
              {scrollHints.right && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex w-[14px] items-center justify-center text-[32px] leading-none text-slate-500">⋮</span>
              )}
            </div>
            <button
              className="mt-3 min-h-[72px] w-[286.45px] max-w-full self-center rounded-xl bg-blue-600 text-xl font-extrabold text-white disabled:bg-slate-200 disabled:text-slate-400"
              disabled={busy || !transactionCompleted || state.remaining !== 0}
              onClick={() => void complete()}
              type="button"
            >{transactionCompleted && state.remaining === 0 && lastPaymentAutoCompleteEnabled && autoCompleteSeconds !== null && autoCompleteSeconds > 0 && secondsUntilClose !== null ? `${secondsUntilClose}초후 결제완료` : "결제완료"}</button>
          </section>
        </div>
      </section>
      {otherOpen && (
        <OtherPaymentDialog allowOverpayment={Boolean(selectedCustomer) && !stagedCustomerPayment} busy={busy} close={() => setOtherOpen(false)} onSelectCustomer={() => setCustomerSelectOpen(true)} remaining={displayRemaining} customerRemaining={state.remaining} selectedCustomer={selectedCustomer} submit={submitOtherPayment} submitCustomer={stageCustomerPayment} />
      )}
      {overpaymentPrompt && <ConfirmOverpaymentDialog
        compact={overpaymentPrompt.kind === "CARD" || overpaymentPrompt.kind === "CASH"}
        methodLabel={overpaymentPrompt.methodLabel}
        amount={overpaymentPrompt.amount}
        due={overpaymentPrompt.due}
        excess={overpaymentPrompt.excess}
        busy={busy}
        secondaryLabel={overpaymentPrompt.kind === "CARD" ? "결제 초기화" : "취소"}
        secondaryAction={() => {
          if (overpaymentPrompt.kind === "CARD") {
            setOverpaymentPrompt(null);
            void resetPayments(true);
          } else {
            void resolveOverpayment(false);
          }
        }}
        confirm={() => void resolveOverpayment(true)}
      />}
      {cardErrorDialog && <CardErrorDialog message={cardErrorDialog.message} close={() => {
        if (cardErrorDialog.resetInputOnClose) setInput("");
        setCardErrorDialog(null);
      }} />}
      {customerSelectOpen && <CustomerSelectDialog
        selected={selectedCustomer}
        onClose={() => setCustomerSelectOpen(false)}
        onSelect={customer => { onSelectCustomer(customer); if (customer) setCustomerSelectOpen(false); }}
      />}
      {deletionTarget && (
        <PaymentDeletionDialog
          busy={busy}
          error={cancelError}
          paymentLabel={deletionTarget.kind === "SAVED" ? paymentMethodLabel(deletionTarget.payment) : `${stagedCustomerPayment?.name ?? "고객"} 고객결제`}
          paymentAmount={deletionTarget.kind === "SAVED" ? deletionTarget.payment.receivedAmount : stagedCustomerPayment?.amount ?? 0}
          close={() => {
            if (busy) return;
            setCancelError("");
            setDeletionTarget(null);
            completionPausedRef.current = false;
            if (transactionCompleted && hasPaymentAction) setCompletedAtMs(Date.now());
          }}
          submit={() => void cancelPayment()}
        />
      )}
      {resetPaymentsConfirm && (
        <PaymentResetDialog
          busy={busy}
          error={cancelError}
          close={() => { if (!busy) { setResetPaymentsConfirm(false); setCancelError(""); completionPausedRef.current = false; if (transactionCompleted && hasPaymentAction) setCompletedAtMs(Date.now()); } }}
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
  paymentLabel,
  paymentAmount,
  close,
  submit,
}: {
  error: string;
  busy: boolean;
  paymentLabel: string;
  paymentAmount: number;
  close: () => void;
  submit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
      <section aria-modal="true" aria-describedby="payment-deletion-prompt" className="w-full max-w-[420px] overflow-hidden rounded-2xl bg-white shadow-2xl" role="alertdialog">
        <PosSubHeader title="결제내역 삭제" />
        <div className="px-7 py-7">
          <div className="space-y-3 text-center">
            <div className="flex items-baseline justify-center gap-5 text-lg text-slate-800"><span>{paymentLabel}</span><strong className="text-xl font-extrabold tabular-nums">{money(paymentAmount)}</strong></div>
            <p className="text-center text-xl font-bold text-slate-900" id="payment-deletion-prompt">삭제하시겠습니까?</p>
          </div>
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
      <PosSubHeader backLabel="결제 초기화 닫기" onBack={close} title="결제 초기화" />
      <div className="px-7 py-6">
        <p className="text-center text-lg font-bold text-slate-800">등록된 결제 {paymentCount}건을 취소하고<br />결제 입력을 초기화하시겠습니까?</p>
        {error && <p aria-live="polite" className="mt-4 text-center text-sm font-bold text-red-600">{error}</p>}
        <button className="mt-6 min-h-[53px] w-full rounded-xl bg-red-600 text-base font-extrabold text-white disabled:opacity-40" disabled={busy} onClick={submit} type="button">{busy ? "초기화 중..." : "결제 초기화"}</button>
      </div>
    </section>
  </div>;
}

function ConfirmOverpaymentDialog({ compact, methodLabel, amount, due, excess, busy, secondaryLabel, secondaryAction, confirm }: { compact: boolean; methodLabel: string; amount: number; due: number; excess: number; busy: boolean; secondaryLabel: string; secondaryAction: () => void; confirm: () => void }) {
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/55 p-4">
    <section aria-modal="true" className={`w-full ${compact ? "max-w-[440px]" : "max-w-[480px]"} overflow-hidden rounded-2xl bg-white shadow-2xl`} role="dialog">
      <PosSubHeader title={`${methodLabel} 초과결제 확인`} />
      <div className={`px-7 ${compact ? "py-5" : "py-6"} text-lg`}>
        {compact ? (
          <>
            <p>받을금액보다 {money(excess)}원 많습니다.</p>
            <p className="mt-3">{money(excess)}원을 선불금으로 적립하시겠습니까?</p>
          </>
        ) : (
          <>
            <p>{methodLabel} 금액이 받을금액보다 많습니다.</p>
            <p className="mt-2">초과금액 {money(excess)}원을 선불금으로<br />적립하시겠습니까?</p>
            <div className="mt-4 space-y-1 rounded-lg bg-slate-50 px-4 py-3 text-base text-slate-700">
              <div className="flex justify-between"><span>받을금액</span><b>{money(due)}</b></div>
              <div className="flex justify-between"><span>{methodLabel} 결제금액</span><b>{money(amount)}</b></div>
            </div>
          </>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button className="min-h-12 rounded-lg border border-slate-300 px-6 font-bold" disabled={busy} onClick={secondaryAction} type="button">{secondaryLabel}</button>
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
        <p className="whitespace-pre-line">{message}</p>
        <button autoFocus className="mt-7 min-h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white" onClick={close} type="button">확인</button>
      </div>
    </section>
  </div>;
}
