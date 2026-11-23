import assert from "node:assert/strict";
import test from "node:test";
import { mergeQrOrderNotifications, qrOrderNotificationMessage, qrOrderNotificationTime, shouldOpenQrOrdersForTable } from "./qr-order-notification-model.ts";

test("only an empty table with a pending QR order shortcuts to QR Orders", () => {
  assert.equal(shouldOpenQrOrdersForTable({ sessionId: null, hasPendingQrOrder: true }), true);
  assert.equal(shouldOpenQrOrdersForTable({ sessionId: null, hasPendingQrOrder: false }), false);
  assert.equal(shouldOpenQrOrdersForTable({ sessionId: null }), false);
  assert.equal(shouldOpenQrOrdersForTable({ sessionId: 12, hasPendingQrOrder: true }), false);
});

test("QR order notification message uses the table number without embedding time or QR details", () => {
  assert.equal(qrOrderNotificationMessage({ qrOrderId: 1, tableId: 8, tableNo: "1", orderedAt: "2026-11-18T17:37:09" }),
    "1T 주문이 접수되었습니다.");
  assert.equal(qrOrderNotificationMessage({ qrOrderId: 2, tableId: 9, tableNo: "2", orderedAt: "2026-11-18T17:38:09" }),
    "2T 주문이 접수되었습니다.");
  assert.equal(qrOrderNotificationMessage({ qrOrderId: 3, tableId: 10, tableNo: "ZZQR1c2115754446", orderedAt: "2026-11-18T17:39:09" }),
    "주문이 접수되었습니다.");
  assert.equal(qrOrderNotificationMessage({ qrOrderId: 4, tableId: 0, tableNo: "", orderedAt: "2026-11-18T17:40:09" }),
    "주문이 접수되었습니다.");
});

test("QR notification time stays separate from the message", () => {
  assert.equal(qrOrderNotificationTime({ qrOrderId: 1, tableId: 8, tableNo: "1", orderedAt: "2026-11-18T17:37:09" }), "17:37");
  assert.equal(qrOrderNotificationTime({ qrOrderId: 1, tableId: 8, tableNo: "1", orderedAt: "invalid" }), "--:--");
});

test("notification polling merges duplicate event IDs once and keeps the newest bounded set", () => {
  const event = qrOrderId => ({ qrOrderId, tableId: qrOrderId, tableNo: String(qrOrderId), orderedAt: "2026-11-18T17:37:00" });
  assert.deepEqual(mergeQrOrderNotifications([event(1)], [event(1), event(2)]), [event(1), event(2)]);
  assert.deepEqual(mergeQrOrderNotifications([], [event(1), event(2), event(3)], 2), [event(2), event(3)]);
});
