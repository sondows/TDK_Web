"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { qrOrderIssuedTimeLabel, qrOrderPeopleLabel, sortQrOrderTables, type QrOrderTableListItem } from "@/lib/qr-orders-list-model";
import { qrOrderRoundNumber, sortQrOrdersNewestFirst } from "@/lib/qr-order-history-model";
import { qrOrderApprovalTarget } from "@/lib/qr-order-approval-navigation";
import { parseJsonResponse } from "@/lib/api-response";

type OrderHistory = { qrOrderId: number; status: "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED"; totalAmount: string;
  orderedAt: string; note: string | null; items: Array<{ qrOrderItemId: number; itemName: string; qty: number;
    unitPrice: string; totalAmount: string; note: string | null; options: Array<{ optionName: string; qty: number; totalAmount: string }> }> };
type OrderHistoryState = { key: string; data: { orders: OrderHistory[]; orderCount: number; totalAmount: number } | null; error: string };

const money = (amount: number | string) => `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Number(amount) || 0)}원`;
const statusLabel: Record<OrderHistory["status"], string> = { PENDING: "승인 대기", ACCEPTED: "승인", REJECTED: "거절", CANCELLED: "취소" };
const timeLabel = (time: string) => time.slice(11, 16);

export default function QrOrdersWorkspace({ tables, onChanged, selectionRequest = null, onSelectionChanged, onAccepted, onBlockingUiChange }: {
  tables: QrOrderTableListItem[]; onChanged?: () => void; selectionRequest?: { tableId: number; requestId: number } | null;
  onSelectionChanged?: () => void; onAccepted?: (tableId: number) => void; onBlockingUiChange?: (blocking: boolean) => void;
}) {
  const sortedTables = useMemo(() => sortQrOrderTables(tables), [tables]);
  const [selection, setSelection] = useState<{ tableId: number; issuedAt: string } | null>(null);
  const requestedTable = selectionRequest ? sortedTables.find(table => table.tableId === selectionRequest.tableId) ?? null : null;
  const selectedTable = requestedTable ?? sortedTables.find(table => table.tableId === selection?.tableId && table.issuedAt === selection.issuedAt) ?? null;
  const selectedKey = selectedTable ? `${selectedTable.tableId}:${selectedTable.issuedAt}` : "";
  const selectedTableId = selectedTable?.tableId ?? null;
  const selectedTableIssuedAt = selectedTable?.issuedAt ?? null;
  const [historyState, setHistoryState] = useState<OrderHistoryState | null>(null);
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const busyOrderIdRef = useRef<number | null>(null);
  const [rejectPromptId, setRejectPromptId] = useState<number | null>(null);
  const [decisionError, setDecisionError] = useState("");
  const [tokenCancelOpen, setTokenCancelOpen] = useState(false);
  const [tokenCancelBusy, setTokenCancelBusy] = useState(false);
  const [tokenCancelError, setTokenCancelError] = useState("");
  const [tokenNotice, setTokenNotice] = useState<{ key: string; message: string } | null>(null);
  const currentHistory = historyState?.key === selectedKey ? historyState.data : null;
  const orderedHistory = currentHistory ? sortQrOrdersNewestFirst(currentHistory.orders) : [];
  const latestPendingOrderId = orderedHistory.find(order => order.status === "PENDING")?.qrOrderId ?? null;

  useEffect(() => {
    onBlockingUiChange?.(busyOrderId !== null || rejectPromptId !== null || tokenCancelOpen || tokenCancelBusy);
  }, [busyOrderId, onBlockingUiChange, rejectPromptId, tokenCancelBusy, tokenCancelOpen]);

  useEffect(() => () => onBlockingUiChange?.(false), [onBlockingUiChange]);

  useEffect(() => {
    if (selectedTableId === null || selectedTableIssuedAt === null) return;
    const controller = new AbortController();
    const key = `${selectedTableId}:${selectedTableIssuedAt}`;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/qr/staff-order-history?tableId=${encodeURIComponent(selectedTableId)}`, {
          cache: "no-store", signal: controller.signal,
        });
        const result = await parseJsonResponse<{ success?: boolean; orders?: OrderHistory[]; orderCount?: number; totalAmount?: number; message?: string }>(
          response, `/api/qr/staff-order-history?tableId=${encodeURIComponent(selectedTableId)}`, "QR order history lookup", "GET",
        );
        if (!response.ok || !result.success || !Array.isArray(result.orders)) throw new Error(result.message || "QR 주문내역을 불러오지 못했습니다.");
        if (!controller.signal.aborted) setHistoryState({ key, data: {
          orders: result.orders, orderCount: Number(result.orderCount ?? result.orders.length), totalAmount: Number(result.totalAmount ?? 0),
        }, error: "" });
      } catch (cause) {
        if (!controller.signal.aborted) setHistoryState({ key, data: null,
          error: cause instanceof Error ? cause.message : "QR 주문내역을 불러오지 못했습니다." });
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [historyRefreshVersion, selectedTableId, selectedTableIssuedAt]);

  const decideOrder = async (qrOrderId: number, action: "ACCEPT" | "REJECT") => {
    if (busyOrderIdRef.current !== null) return;
    busyOrderIdRef.current = qrOrderId;
    setBusyOrderId(qrOrderId);
    setDecisionError("");
    try {
      const response = await fetch("/api/pos/qr-table-orders", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrOrderId, action }) });
      const result = await parseJsonResponse<{ success?: boolean; message?: string }>(response, "/api/pos/qr-table-orders", "QR order processing", "PATCH");
      if (!response.ok || !result.success) throw new Error(result.message || "QR 주문을 처리하지 못했습니다.");
      setRejectPromptId(null);
      const approvedTableId = qrOrderApprovalTarget(action, response.ok && result.success === true, selectedTable?.tableId);
      if (approvedTableId !== null && onAccepted) onAccepted(approvedTableId);
      else onChanged?.();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : "QR 주문을 처리하지 못했습니다.");
      onChanged?.();
    } finally {
      setHistoryRefreshVersion(version => version + 1);
      busyOrderIdRef.current = null;
      setBusyOrderId(null);
    }
  };

  const hideRejectedOrder = async (qrOrderId: number) => {
    if (!window.confirm("거절된 QR 주문을 목록에서 삭제하시겠습니까?")) return;
    setBusyOrderId(qrOrderId);
    setDecisionError("");
    try {
      const response = await fetch("/api/qr/staff-order-history", { method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrOrderId }) });
      const result = await parseJsonResponse<{ success?: boolean; message?: string }>(response, "/api/qr/staff-order-history", "Hide rejected QR order", "DELETE");
      if (!response.ok || !result.success) throw new Error(result.message || "거절된 QR 주문을 목록에서 숨기지 못했습니다.");
      onChanged?.();
    } catch (cause) {
      setDecisionError(cause instanceof Error ? cause.message : "거절된 QR 주문을 목록에서 숨기지 못했습니다.");
      onChanged?.();
    } finally {
      setHistoryRefreshVersion(version => version + 1);
      setBusyOrderId(null);
    }
  };

  const cancelTableToken = async () => {
    if (!selectedTable) return;
    setTokenCancelBusy(true);
    setTokenCancelError("");
    try {
      const response = await fetch("/api/qr/staff-table-token", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: selectedTable.tableId }) });
      const result = await parseJsonResponse<{ success?: boolean; fixedStickerPreserved?: boolean; message?: string }>(
        response, "/api/qr/staff-table-token", "QR token cancellation", "POST",
      );
      if (!response.ok || !result.success) throw new Error(result.message || "QR 토큰을 취소하지 못했습니다.");
      setTokenCancelOpen(false);
      setTokenNotice({ key: selectedKey, message: "QR 토큰을 취소했습니다. 고정 QR 스티커는 계속 사용할 수 있습니다." });
      onChanged?.();
    } catch (cause) {
      setTokenCancelError(cause instanceof Error ? cause.message : "QR 토큰을 취소하지 못했습니다.");
      setHistoryRefreshVersion(version => version + 1);
      onChanged?.();
    } finally {
      setTokenCancelBusy(false);
    }
  };

  return <div className="grid h-full min-h-0 w-full grid-cols-3 gap-3 px-4 pb-4" data-qr-orders-workspace>
    <section aria-label="QR 주문 테이블 목록" className="col-span-1 min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
      {sortedTables.length > 0 ? <div className="flex flex-col gap-2">
        {sortedTables.map(table => <button aria-pressed={selectedTable?.tableId === table.tableId}
          className={`min-h-[66px] rounded-lg border px-3 py-2 text-left transition-colors ${selectedTable?.tableId === table.tableId ? "border-blue-500 bg-blue-50 ring-1 ring-blue-300" : "border-slate-200 bg-white hover:border-blue-300"}`}
          key={table.tableId} onClick={() => { setSelection({ tableId: table.tableId, issuedAt: table.issuedAt }); onSelectionChanged?.(); setDecisionError(""); setTokenNotice(null); }} type="button">
          <span className="flex min-w-0 items-center justify-between gap-2 text-sm font-extrabold text-slate-800">
            <span className="truncate">{table.tableNo} T</span><time className="shrink-0 tabular-nums text-xs font-semibold text-slate-500" dateTime={table.issuedAt}>{qrOrderIssuedTimeLabel(table.issuedAt)}</time>
          </span>
          <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-xs font-bold">
            <span className={`shrink-0 ${table.hasPendingQrOrder ? "text-red-600" : "text-[#1769D2]"}`}>{table.hasPendingQrOrder ? "QR 주문대기" : "토큰발급"}</span>
            <span className="truncate text-right font-medium text-slate-600">{qrOrderPeopleLabel(table.adultCount, table.babyCount)}</span>
          </span>
        </button>)}
      </div> : <p className="grid min-h-24 place-items-center text-center text-sm text-slate-500">유효한 QR 토큰이 없습니다.</p>}
    </section>
    <section aria-label="선택 테이블 정보" className="col-span-2 min-h-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5">
      {selectedTable ? <div>
        <div aria-label="QR 토큰 정보" className="flex min-h-10 items-center gap-3 overflow-x-auto border-b border-slate-100 pb-3 text-sm whitespace-nowrap">
          <strong className={`shrink-0 rounded-md px-2 py-1 ${selectedTable.hasActiveQrToken ? "bg-blue-50 text-[#1769D2]" : "bg-amber-50 text-amber-700"}`}>{selectedTable.hasActiveQrToken ? "QR 토큰 발행" : "QR 토큰 만료"}</strong>
          <time className="shrink-0 tabular-nums text-slate-600" dateTime={selectedTable.issuedAt}>{qrOrderIssuedTimeLabel(selectedTable.issuedAt)}</time>
          <span className="shrink-0 text-slate-500">도우미 상태 확인 불가</span>
          <button className="ml-auto min-h-9 shrink-0 rounded-md border border-red-200 px-3 font-bold text-red-700 hover:bg-red-50" onClick={() => { setTokenCancelError(""); setTokenCancelOpen(true); }} type="button">토큰취소</button>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <h2 className="text-lg font-extrabold text-slate-900">주문내역</h2>
          <div className="flex shrink-0 items-center gap-4 text-sm"><span>{currentHistory?.orderCount ?? (historyState?.key === selectedKey && historyState.error ? 0 : "…")}건</span><strong>{currentHistory ? money(currentHistory.totalAmount) : "…"}</strong></div>
        </div>
        {decisionError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">{decisionError}</p>}
        <div className="mt-3 space-y-3">
          {historyState?.key === selectedKey && historyState.error ? <p className="py-8 text-center text-sm font-semibold text-red-600" role="alert">{historyState.error}</p>
            : !currentHistory ? <p className="py-8 text-center text-sm text-slate-500">주문내역을 불러오는 중입니다.</p>
              : orderedHistory.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">아직 QR 주문이 없습니다.</p>
                : orderedHistory.map((order, index) => <article className={`rounded-xl border bg-white ${order.qrOrderId === latestPendingOrderId ? "border-red-300 ring-2 ring-red-100" : "border-slate-200"}`} key={order.qrOrderId}>
                  <div className="flex min-h-11 items-center justify-between gap-2 rounded-t-xl bg-slate-50 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2"><strong className="shrink-0">{qrOrderRoundNumber(index, currentHistory.orderCount)}차</strong><time className="text-sm tabular-nums text-slate-600" dateTime={order.orderedAt}>{timeLabel(order.orderedAt)}</time>{order.qrOrderId === latestPendingOrderId && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-extrabold text-red-700">최신 미처리</span>}</div>
                    {order.status === "PENDING" ? <div className="flex shrink-0 gap-2"><button className="min-h-8 rounded-md bg-slate-200 px-3 text-xs font-bold text-slate-600 disabled:opacity-60" disabled={busyOrderId !== null} onClick={() => setRejectPromptId(order.qrOrderId)} type="button">거절</button><button className="min-h-8 rounded-md bg-blue-700 px-3 text-xs font-bold text-white disabled:opacity-60" disabled={busyOrderId !== null} onClick={() => void decideOrder(order.qrOrderId, "ACCEPT")} type="button">{busyOrderId === order.qrOrderId ? "처리 중…" : "승인"}</button></div>
                      : <div className="flex shrink-0 items-center gap-2"><strong className={`text-sm ${order.status === "ACCEPTED" ? "text-blue-700" : order.status === "REJECTED" ? "text-red-600" : "text-slate-500"}`}>{statusLabel[order.status]}</strong>{order.status === "REJECTED" && <button className="min-h-8 rounded-md border border-slate-300 px-3 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50" disabled={busyOrderId !== null} onClick={() => void hideRejectedOrder(order.qrOrderId)} type="button">{busyOrderId === order.qrOrderId ? "처리 중..." : "삭제"}</button>}</div>}
                  </div>
                  {order.note && <p className="px-3 pt-2 text-xs leading-5 text-slate-500">{order.note}</p>}
                  <div className="divide-y divide-slate-100 px-3">
                    {order.items.map(item => <div className="py-2" key={item.qrOrderItemId}>
                      <div className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words font-medium">{item.itemName} × {item.qty}</span><strong className="shrink-0 tabular-nums">{money(item.totalAmount)}</strong></div>
                      {item.options.length > 0 && <ul className="mt-1 space-y-0.5 pl-2 text-xs text-slate-500">{item.options.map((option, optionIndex) => <li className="flex justify-between gap-2" key={`${item.qrOrderItemId}:${optionIndex}`}><span>{option.optionName}{option.qty > 1 ? ` × ${option.qty}` : ""}</span><span className="shrink-0">{money(option.totalAmount)}</span></li>)}</ul>}
                      {item.note && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">{item.note}</p>}
                    </div>)}
                  </div>
                  <div className="flex justify-end border-t border-slate-100 px-3 py-2 text-sm"><span className="text-slate-500">회차 금액</span><strong className="ml-3 tabular-nums">{money(order.totalAmount)}</strong></div>
                </article>)}
        </div>
      </div> : tokenNotice ? <p className="grid h-full min-h-32 place-items-center px-6 text-center text-sm font-semibold text-slate-600" role="status">{tokenNotice.message}</p>
        : <p className="grid h-full min-h-32 place-items-center text-sm text-slate-500">왼쪽 목록에서 테이블을 선택하세요.</p>}
    </section>
    {rejectPromptId !== null && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setRejectPromptId(null)}>
      <section aria-labelledby="qr-reject-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="alertdialog">
        <h2 className="text-lg font-extrabold text-slate-900" id="qr-reject-title">QR 주문을 거절할까요?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">거절하면 고객 주문내역에 거절 상태가 표시되고, 주방에는 전달되지 않습니다.</p>
        {decisionError && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{decisionError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2"><button className="min-h-11 rounded-lg bg-slate-100 font-bold" disabled={busyOrderId !== null} onClick={() => setRejectPromptId(null)} type="button">취소</button><button className="min-h-11 rounded-lg bg-red-600 font-bold text-white disabled:opacity-50" disabled={busyOrderId !== null} onClick={() => void decideOrder(rejectPromptId, "REJECT")} type="button">주문 거절</button></div>
      </section>
    </div>}
    {tokenCancelOpen && selectedTable && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => { if (!tokenCancelBusy) setTokenCancelOpen(false); }}>
      <section aria-labelledby="qr-token-cancel-title" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="alertdialog">
        <h2 className="text-lg font-extrabold text-slate-900" id="qr-token-cancel-title">테이블 {selectedTable.tableNo} QR 토큰을 취소할까요?</h2><p className="mt-2 text-sm leading-6 text-slate-600">활성 QR 토큰과 초대 링크를 취소합니다. 테이블에 부착된 고정 QR 스티커와 주문 기록은 유지됩니다.</p>
        {tokenCancelError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">{tokenCancelError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2"><button className="min-h-11 rounded-lg bg-slate-100 font-bold" disabled={tokenCancelBusy} onClick={() => setTokenCancelOpen(false)} type="button">돌아가기</button><button className="min-h-11 rounded-lg bg-red-600 font-bold text-white disabled:opacity-50" disabled={tokenCancelBusy} onClick={() => void cancelTableToken()} type="button">{tokenCancelBusy ? "취소 중…" : "토큰취소"}</button></div>
      </section>
    </div>}
  </div>;
}
