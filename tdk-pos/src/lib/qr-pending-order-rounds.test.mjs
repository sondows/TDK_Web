import test from "node:test";
import assert from "node:assert/strict";
import { assignQrOrderRoundNumbers } from "./qr-pending-order-rounds.ts";

test("QR order round numbers use chronological receipt time within a session", () => {
  const result = assignQrOrderRoundNumbers([
    { qrOrderId: 3, tableId: 8, sessionId: 40, orderedAt: "2026-01-01T12:20:00" },
    { qrOrderId: 1, tableId: 8, sessionId: 40, orderedAt: "2026-01-01T12:00:00" },
    { qrOrderId: 2, tableId: 8, sessionId: 40, orderedAt: "2026-01-01T12:10:00" },
  ]);
  assert.deepEqual(result.map(order => [order.qrOrderId, order.roundNumber]), [[1, 1], [2, 2], [3, 3]]);
});

test("same-time orders use the order ID and independent table sessions stay separate", () => {
  const result = assignQrOrderRoundNumbers([
    { qrOrderId: 9, tableId: 8, sessionId: 41, orderedAt: "2026-01-01T12:00:00" },
    { qrOrderId: 7, tableId: 8, sessionId: 40, orderedAt: "2026-01-01T12:00:00" },
    { qrOrderId: 6, tableId: 8, sessionId: 40, orderedAt: "2026-01-01T12:00:00" },
    { qrOrderId: 5, tableId: 3, sessionId: null, orderedAt: "2026-01-01T12:00:00" },
    { qrOrderId: 4, tableId: 3, sessionId: null, orderedAt: "2026-01-01T12:01:00" },
  ]);
  assert.deepEqual(result.map(order => [order.qrOrderId, order.roundNumber]), [[5, 1], [6, 1], [7, 2], [9, 1], [4, 2]]);
});
