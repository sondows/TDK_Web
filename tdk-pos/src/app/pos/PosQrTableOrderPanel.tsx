"use client";

import { useCallback, useEffect, useState } from "react";
import { readPosQrTableResponse } from "@/lib/pos-qr-table-response";

type Order = { qrOrderId: number; tableNo: string; languageCode: string; totalAmount: string; orderedAt: string; note: string | null;
  items: Array<{ qrOrderItemId: number; itemName: string; qty: number; totalAmount: string; options: Array<{ optionName: string; qty: number }> }> };
const money = (value: string) => `${new Intl.NumberFormat("ko-KR").format(Math.round(Number(value)))}원`;

export default function PosQrTableOrderPanel({ onChanged }: { onChanged: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/pos/qr-table-orders", { cache: "no-store" });
    const payload = await readPosQrTableResponse<{ success?: boolean; orders?: Order[]; message?: string }>(response, "테이블 QR 주문 조회");
    if (!Array.isArray(payload.orders)) throw new Error("테이블 QR 주문 조회 응답에 주문 목록이 없습니다.");
    setOrders(payload.orders);
    setError("");
    setLoaded(true);
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () => void refresh().catch(reason => { if (alive) { setLoaded(true); setError(reason instanceof TypeError ? "네트워크 연결을 확인해 주세요." : reason instanceof Error ? reason.message : "불러오지 못했습니다."); } });
    const timer = window.setInterval(load, 3000);
    load();
    return () => { alive = false; window.clearInterval(timer); };
  }, [refresh]);

  const decide = async (qrOrderId: number, action: "ACCEPT" | "REJECT") => {
    if (action === "REJECT" && !window.confirm("이 QR 주문을 거절할까요? 고객 주문내역에 거절로 표시되고 주방에는 전달되지 않습니다.")) return;
    setBusyId(qrOrderId); setError("");
    try {
      const response = await fetch("/api/pos/qr-table-orders", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrOrderId, action }) });
      await readPosQrTableResponse<{ success?: boolean; message?: string }>(response, "QR 주문 처리");
      await refresh(); onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "QR 주문을 처리하지 못했습니다."); }
    finally { setBusyId(null); }
  };

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3">
    <div className="flex items-center justify-between px-1 py-2"><h2 className="font-extrabold">테이블 QR 주문</h2><button className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold" onClick={() => void refresh()} type="button">새로고침</button></div>
    {error && <p className="px-1 py-1 text-xs font-semibold text-red-600" role="alert">{error}</p>}
    {!loaded && <p className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-400">테이블 QR 주문을 불러오는 중입니다.</p>}
    {loaded && !error && !orders.length && <p className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-400">승인 대기 중인 테이블 QR 주문이 없습니다.</p>}
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">{orders.map(order => <article className="rounded-xl border border-blue-100 bg-blue-50/50 p-3" key={order.qrOrderId}>
      <div className="flex justify-between gap-2"><strong>테이블 {order.tableNo}</strong><span className="text-xs text-slate-500">{new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(order.orderedAt))}</span></div>
      <ul className="mt-2 space-y-1 text-sm">{order.items.map(item => <li key={item.qrOrderItemId}><div className="flex justify-between"><span>{item.itemName} × {item.qty}</span><span>{money(item.totalAmount)}</span></div>{item.options.length > 0 && <p className="text-xs text-slate-500">{item.options.map(option => `${option.optionName}${option.qty > 1 ? ` ×${option.qty}` : ""}`).join(" · ")}</p>}</li>)}</ul>
      <div className="mt-2 flex items-center justify-between border-t border-blue-100 pt-2"><strong>{money(order.totalAmount)}</strong><div className="flex gap-2"><button className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-bold" disabled={busyId === order.qrOrderId} onClick={() => void decide(order.qrOrderId, "REJECT")} type="button">반려</button><button className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white" disabled={busyId === order.qrOrderId} onClick={() => void decide(order.qrOrderId, "ACCEPT")} type="button">승인</button></div></div>
    </article>)}</div>
  </div>;
}
