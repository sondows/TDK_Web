import assert from "node:assert/strict";
import test from "node:test";
import { buildUnifiedQrOrderRounds } from "./qr-unified-order-rounds.ts";

test("numbers POS and accepted QR orders by actual POS intake time, not QR request time", () => {
  const qrOrders = [
    { qrOrderId: 20, acceptedOrderId: 102, orderedAt: "2026-11-20T11:00:00+09:00" },
    { qrOrderId: 21, acceptedOrderId: 104, orderedAt: "2026-11-20T11:05:00+09:00" },
    { qrOrderId: 22, acceptedOrderId: null, orderedAt: "2026-11-20T11:10:00+09:00" },
  ];
  const posOrders = [
    { orderId: 103, orderedAt: "2026-11-20T12:10:00+09:00", status: "ACCEPTED" },
    { orderId: 104, orderedAt: "2026-11-20T12:15:00+09:00", status: "ACCEPTED" },
    { orderId: 101, orderedAt: "2026-11-20T12:00:00+09:00", status: "ACCEPTED" },
    { orderId: 102, orderedAt: "2026-11-20T12:05:00+09:00", status: "ACCEPTED" },
  ];
  const rounds = buildUnifiedQrOrderRounds(qrOrders, [{ qrOrderId: 20 }, { qrOrderId: 21 }], posOrders,
    posOrders.map(order => ({ orderId: order.orderId })));
  assert.deepEqual(rounds.map(round => [round.roundNumber, round.source, round.source === "QR"
    ? round.acceptedPosOrder.orderId : round.order.orderId]), [
    [4, "QR", 104], [3, "POS", 103], [2, "QR", 102], [1, "POS", 101],
  ]);
  assert.equal(rounds.length, 4, "Pending request and accepted POS order are not extra rounds");
});

test("uses stable POS order ID for equal timestamps and retains confirmed cancellation history", () => {
  const sameTime = "2026-11-20T12:00:00+09:00";
  const rounds = buildUnifiedQrOrderRounds([], [], [
    { orderId: 9, orderedAt: sameTime, status: "CANCELLED" },
    { orderId: 8, orderedAt: sameTime, status: "ACCEPTED" },
  ], []);
  assert.deepEqual(rounds.map(round => [round.roundNumber, round.order.orderId]), [[2, 9], [1, 8]]);
});
