"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PendingQrOrder = {
  qrOrderId: number;
  tableId: number;
  tableNo: string;
  sessionId: number | null;
  roundNumber: number;
  orderedAt: string;
  totalAmount: string;
  note: string | null;
  items: Array<{
    qrOrderItemId: number;
    itemName: string;
    qty: number;
    totalAmount: string;
    options: Array<{ optionName: string; qty: number }>;
  }>;
};

const money = (value: number | string) => `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Number(value) || 0)}원`;
const orderTime = (value: string) => {
  const time = value.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(time) ? time : "--:--";
};

function QrReceiptDivider() {
  return <div aria-hidden="true" className="my-2 h-[2px]" style={{
    backgroundImage: "repeating-linear-gradient(to right, #9BA8BA 0 12px, transparent 12px 18px), repeating-linear-gradient(to right, #FFFFFF 0 12px, transparent 12px 18px)",
    backgroundSize: "100% 1px, 100% 1px",
    backgroundPosition: "top, bottom",
    backgroundRepeat: "no-repeat",
    filter: "drop-shadow(0 1px 1px rgba(71, 85, 105, 0.16))",
  }} />;
}

export default function HosQrPendingOrders({ onChanged, onBlockingUiChange, onPendingCountChange }: {
  onChanged?: () => void;
  onBlockingUiChange?: (blocking: boolean) => void;
  onPendingCountChange?: (count: number) => void;
}) {
  const [orders, setOrders] = useState<PendingQrOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [rejectPromptId, setRejectPromptId] = useState<number | null>(null);
  const requestSequenceRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const processingIdRef = useRef<number | null>(null);

  const loadPendingOrders = useCallback(async () => {
    if (document.visibilityState === "hidden" || loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    const requestSequence = ++requestSequenceRef.current;
    try {
      const response = await fetch("/api/pos/qr-table-orders", { cache: "no-store" });
      const result = await response.json() as { success?: boolean; orders?: PendingQrOrder[]; message?: string };
      if (!response.ok || !result.success || !Array.isArray(result.orders)) throw new Error(result.message || "QR 주문 목록을 불러오지 못했습니다.");
      if (requestSequence !== requestSequenceRef.current) return;
      setOrders(result.orders);
      onPendingCountChange?.(result.orders.length);
      setLoadError("");
    } catch (cause) {
      if (requestSequence === requestSequenceRef.current) setLoadError(cause instanceof Error ? cause.message : "QR 주문 목록을 불러오지 못했습니다.");
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoaded(true);
      loadInFlightRef.current = false;
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    const firstLoad = window.setTimeout(() => void loadPendingOrders(), 0);
    const interval = window.setInterval(() => void loadPendingOrders(), 3000);
    const onVisible = () => { if (document.visibilityState === "visible") void loadPendingOrders(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      requestSequenceRef.current += 1;
      window.clearTimeout(firstLoad);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadPendingOrders]);

  useEffect(() => {
    onBlockingUiChange?.(processingId !== null || rejectPromptId !== null);
  }, [onBlockingUiChange, processingId, rejectPromptId]);
  useEffect(() => () => onBlockingUiChange?.(false), [onBlockingUiChange]);

  const decideOrder = async (qrOrderId: number, action: "ACCEPT" | "REJECT") => {
    if (processingIdRef.current !== null) return;
    processingIdRef.current = qrOrderId;
    setProcessingId(qrOrderId);
    setDecisionError("");
    try {
      const response = await fetch("/api/pos/qr-table-orders", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrOrderId, action }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || "QR 주문을 처리하지 못했습니다.");
      requestSequenceRef.current += 1;
      setOrders(current => current.filter(order => order.qrOrderId !== qrOrderId));
      onPendingCountChange?.(Math.max(0, orders.length - 1));
      setRejectPromptId(null);
      onChanged?.();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : "QR 주문을 처리하지 못했습니다.");
      void loadPendingOrders();
    } finally {
      processingIdRef.current = null;
      setProcessingId(null);
    }
  };

  return <div className="mx-auto h-full min-h-0 w-full max-w-3xl overflow-y-auto overscroll-contain px-2 pb-5" data-hos-qr-pending-orders>
    {decisionError && rejectPromptId === null && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">{decisionError}</p>}
    {loadError && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">{loadError}</p>}
    {!loaded && !loadError ? <p className="grid min-h-32 place-items-center text-sm text-slate-500">QR 주문을 불러오는 중입니다.</p>
      : !loaded && loadError ? null
      : orders.length === 0 ? loadError ? null : <p className="grid min-h-48 place-items-center text-center text-sm font-medium text-slate-500">대기 중인 QR 주문이 없습니다.</p>
        : <div>
          {orders.map((order, index) => <div key={order.qrOrderId}>
            {index > 0 && <QrReceiptDivider />}
            <article className="py-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
                  <strong className="shrink-0 text-sm font-extrabold text-slate-800">No.{order.tableNo}</strong>
                  <strong className="shrink-0 text-sm font-extrabold text-slate-800">{order.roundNumber}차 주문</strong>
                  <time className="shrink-0 text-xs tabular-nums text-slate-500" dateTime={order.orderedAt}>({orderTime(order.orderedAt)})</time>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="min-h-9 rounded-md bg-slate-200 px-2.5 text-xs font-bold text-slate-600 disabled:opacity-50" disabled={processingId !== null} onClick={() => { setDecisionError(""); setRejectPromptId(order.qrOrderId); }} type="button">거절</button>
                  <button className="min-h-9 rounded-md bg-blue-700 px-2.5 text-xs font-bold text-white disabled:opacity-50" disabled={processingId !== null} onClick={() => void decideOrder(order.qrOrderId, "ACCEPT")} type="button">{processingId === order.qrOrderId ? "처리 중…" : "승인"}</button>
                </div>
              </div>
              {order.note && <p className="mt-1 text-xs leading-5 text-slate-500">{order.note}</p>}
              <div className="mt-2 space-y-1.5">
                {order.items.map(item => {
                  const optionText = item.options.map(option => `${option.optionName}${option.qty > 1 ? ` × ${option.qty}` : ""}`).join(", ");
                  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3" key={item.qrOrderItemId}>
                    <div className="flex min-w-0 items-baseline gap-1 whitespace-nowrap text-sm">
                      <span className="min-w-0 truncate font-medium text-slate-800" title={item.itemName}>{item.itemName}</span>
                      {optionText && <span className="min-w-0 truncate text-xs text-slate-500" title={optionText}>{optionText}</span>}
                      <strong className="shrink-0 font-semibold text-slate-700">× {item.qty}</strong>
                    </div>
                    <strong className="shrink-0 text-right text-sm tabular-nums text-slate-800">{money(item.totalAmount)}</strong>
                  </div>;
                })}
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 pt-1 text-sm font-bold text-slate-800">
                <span>회차합계</span><strong className="shrink-0 text-right tabular-nums">{money(order.totalAmount)}</strong>
              </div>
            </article>
          </div>)}
        </div>}
    {rejectPromptId !== null && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => { if (processingId === null) setRejectPromptId(null); }}>
      <section aria-labelledby="hos-qr-reject-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="alertdialog">
        <h2 className="text-lg font-extrabold text-slate-900" id="hos-qr-reject-title">QR 주문을 거절할까요?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">거절하면 고객 주문내역에 거절 상태가 표시되고 주방에는 전달되지 않습니다.</p>
        {decisionError && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{decisionError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="min-h-11 rounded-lg bg-slate-100 font-bold disabled:opacity-50" disabled={processingId !== null} onClick={() => setRejectPromptId(null)} type="button">취소</button>
          <button className="min-h-11 rounded-lg bg-red-600 font-bold text-white disabled:opacity-50" disabled={processingId !== null} onClick={() => void decideOrder(rejectPromptId, "REJECT")} type="button">{processingId === rejectPromptId ? "처리 중…" : "주문 거절"}</button>
        </div>
      </section>
    </div>}
  </div>;
}
