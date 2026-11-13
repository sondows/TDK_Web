"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type PosWaitItem = { menuId: number; itemName: string; quantity: number; options: Array<{ modifierOptionId: number; qty: number; optionName: string }>; estimatedUnitPrice: string; estimatedLineTotal: string };
type PosWaitOrder = { waitOrderId: number; publicReference: string; status: "PENDING" | "ASSIGNED"; version: number;
  estimatedTotal: string; assignedSessionId: number | null; createdAt: string | Date; expiresAt: string | Date; items: PosWaitItem[] };
type TableOption = { tableId: number; tableNo: string; sessionId: number | null };

export default function PosQrWaitPanel({ tables, onChanged, onCountChange }: { tables: TableOption[]; onChanged: () => void; onCountChange: (count: number) => void }) {
  const [orders, setOrders] = useState<PosWaitOrder[]>([]);
  const [tableIds, setTableIds] = useState<Record<number, number>>({});
  const [priceAcknowledgements, setPriceAcknowledgements] = useState<Record<number, { version: number; total: string }>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const response = await fetch("/api/pos/qr-wait-orders", { cache: "no-store" });
      const payload = await response.json() as { success?: boolean; orders?: PosWaitOrder[]; message?: string };
      if (!response.ok || !payload.success || !Array.isArray(payload.orders)) throw new Error(payload.message ?? "대기 주문을 불러오지 못했습니다.");
      setOrders(payload.orders);
      onCountChange(payload.orders.length);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "대기 주문을 불러오지 못했습니다."); }
    finally { refreshInFlight.current = false; }
  }, [onCountChange]);

  useEffect(() => {
    let disposed = false;
    const run = async () => { if (!disposed) await refresh(); };
    void run();
    const timer = window.setInterval(() => void run(), 10_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [refresh]);

  const assign = async (order: PosWaitOrder) => {
    const tableId = tableIds[order.waitOrderId];
    if (!tableId || busyId !== null) return;
    setBusyId(order.waitOrderId); setError("");
    try {
      const response = await fetch(`/api/pos/qr-wait-orders/${order.waitOrderId}/assign`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, version: order.version }),
      });
      const payload = await response.json() as { success?: boolean; message?: string; openingRequired?: boolean };
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "테이블 배정에 실패했습니다.");
      await refresh();
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "테이블 배정에 실패했습니다."); }
    finally { setBusyId(null); }
  };

  const confirm = async (order: PosWaitOrder) => {
    if (order.status !== "ASSIGNED" || busyId !== null) return;
    const acknowledgement = priceAcknowledgements[order.waitOrderId];
    setBusyId(order.waitOrderId); setError("");
    try {
      const response = await fetch(`/api/pos/qr-wait-orders/${order.waitOrderId}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: order.version, ...(acknowledgement?.version === order.version ? { acknowledgedTotal: acknowledgement.total } : {}) }),
      });
      const payload = await response.json() as { success?: boolean; message?: string; priceChanged?: boolean; currentTotal?: string; version?: number };
      if (payload.priceChanged && payload.currentTotal && Number.isSafeInteger(payload.version)) {
        setPriceAcknowledgements(current => ({ ...current, [order.waitOrderId]: { version: payload.version!, total: payload.currentTotal! } }));
        await refresh();
        return;
      }
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "대기 주문 확정에 실패했습니다.");
      setPriceAcknowledgements(current => { const next = { ...current }; delete next[order.waitOrderId]; return next; });
      await refresh();
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "대기 주문 확정에 실패했습니다."); }
    finally { setBusyId(null); }
  };

  const cancel = async (order: PosWaitOrder) => {
    if (busyId !== null) return;
    setBusyId(order.waitOrderId); setError("");
    try {
      const response = await fetch(`/api/pos/qr-wait-orders/${order.waitOrderId}/cancel`, { method: "POST" });
      const payload = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "대기 주문을 취소하지 못했습니다.");
      await refresh();
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "대기 주문을 취소하지 못했습니다."); }
    finally { setBusyId(null); }
  };

  return <section aria-label="QR 대기 주문" className="flex min-h-0 flex-col overflow-y-auto px-3 py-2">
    <div className="mb-2 flex items-center justify-between"><h2 className="font-extrabold text-slate-800">QR 대기 주문</h2><button className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold" onClick={() => void refresh()} type="button">새로고침</button></div>
    {error && <p className="mb-2 rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700" role="alert">{error}</p>}
    {!orders.length ? <p className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-400">대기 중인 QR 주문이 없습니다.</p> : <div className="space-y-2">{orders.map(order => {
      const assignedTable = tables.find(table => table.sessionId === order.assignedSessionId);
      const priceAck = priceAcknowledgements[order.waitOrderId];
      return <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" key={order.waitOrderId}>
        <div className="flex items-start justify-between gap-2"><div><strong className="text-lg">#{order.publicReference}</strong><p className="text-xs text-slate-500">{new Date(order.createdAt).toLocaleString("ko-KR")} · {order.status === "PENDING" ? "배정 대기" : `테이블 ${assignedTable?.tableNo ?? "배정됨"}`}</p></div><strong className="shrink-0 tabular-nums">예상 {Number(order.estimatedTotal).toLocaleString("ko-KR")}원</strong></div>
        <ul className="mt-2 space-y-1 text-sm">{order.items.map((item, index) => <li key={`${item.menuId}-${index}`}><span className="font-semibold">{item.itemName} × {item.quantity}</span>{item.options.length > 0 && <span className="ml-1 text-xs text-slate-500">({item.options.map(option => option.optionName).join(", ")})</span>}</li>)}</ul>
        {order.status === "PENDING" ? <div className="mt-3 flex gap-2"><select aria-label={`${order.publicReference} 테이블`} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-2 text-sm" onChange={event => setTableIds(current => ({ ...current, [order.waitOrderId]: Number(event.target.value) }))} value={tableIds[order.waitOrderId] ?? ""}><option value="">테이블 선택</option>{tables.filter(table => table.sessionId === null).map(table => <option key={table.tableId} value={table.tableId}>{table.tableNo}번</option>)}</select><button className="rounded-lg bg-blue-600 px-3 text-sm font-bold text-white disabled:opacity-50" disabled={busyId !== null || !tableIds[order.waitOrderId]} onClick={() => void assign(order)} type="button">{busyId === order.waitOrderId ? "처리 중" : "배정"}</button></div> : <div className="mt-3">
          {priceAck?.version === order.version && <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm"><p className="font-bold text-amber-900">가격 변경 확인</p><p className="mt-1">기존 예상 {Number(order.estimatedTotal).toLocaleString("ko-KR")}원 → 현재 {Number(priceAck.total).toLocaleString("ko-KR")}원</p></div>}
          <div className="flex gap-2"><button className="min-h-11 flex-1 rounded-lg bg-blue-600 font-bold text-white disabled:opacity-50" disabled={busyId !== null} onClick={() => void confirm(order)} type="button">{busyId === order.waitOrderId ? "처리 중..." : priceAck?.version === order.version ? "변경 금액 확인 후 주문 확정" : "직원 확인 후 주문 확정"}</button><button className="min-h-11 rounded-lg bg-red-50 px-3 text-sm font-bold text-red-700 disabled:opacity-50" disabled={busyId !== null} onClick={() => void cancel(order)} type="button">취소</button></div>
        </div>}
      </article>;
    })}</div>}
  </section>;
}
