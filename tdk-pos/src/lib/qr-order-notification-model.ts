export type QrOrderNotification = {
  qrOrderId: number;
  tableId: number;
  tableNo: string;
  orderedAt: string;
};

export function shouldOpenQrOrdersForTable(table: { sessionId: number | null; hasPendingQrOrder?: boolean }) {
  return table.sessionId === null && table.hasPendingQrOrder === true;
}

export function qrOrderNotificationMessage(event: QrOrderNotification) {
  const tableNo = typeof event.tableNo === "string" && /^\d{1,3}$/.test(event.tableNo.trim())
    ? `${event.tableNo.trim()}T `
    : "";
  return `${tableNo}주문이 접수되었습니다.`;
}

export function qrOrderNotificationTime(event: QrOrderNotification) {
  const time = event.orderedAt.slice(11, 16);
  return /^\d{2}:\d{2}$/.test(time) ? time : "--:--";
}

export function mergeQrOrderNotifications(existing: QrOrderNotification[], incoming: QrOrderNotification[], limit = 20) {
  const byId = new Map<number, QrOrderNotification>();
  for (const event of [...existing, ...incoming]) byId.set(event.qrOrderId, event);
  return [...byId.values()].sort((a, b) => a.qrOrderId - b.qrOrderId).slice(-limit);
}
