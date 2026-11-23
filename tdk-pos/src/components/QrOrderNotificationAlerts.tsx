"use client";

import { qrOrderNotificationMessage, qrOrderNotificationTime, type QrOrderNotification } from "@/lib/qr-order-notification-model";

export default function QrOrderNotificationAlerts({ events, onOpenTable }: {
  events: QrOrderNotification[]; onOpenTable: (tableId: number, qrOrderId: number) => void;
}) {
  if (!events.length) return null;
  return <aside aria-label="QR 주문 요청 알림" className="pointer-events-none fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[80] mx-auto flex max-w-lg flex-col gap-2">
    {events.slice(-3).reverse().map(event => <button className="pointer-events-auto flex min-h-12 items-center justify-between gap-3 rounded-xl border border-blue-200 bg-white px-3 py-2 text-left shadow-lg" key={event.qrOrderId}
      onClick={() => onOpenTable(event.tableId, event.qrOrderId)} type="button">
      <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{qrOrderNotificationMessage(event)}</span>
      <span className="shrink-0 text-[10px] text-slate-400">{qrOrderNotificationTime(event)}</span>
      <span className="shrink-0 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">확인</span>
    </button>)}
  </aside>;
}
