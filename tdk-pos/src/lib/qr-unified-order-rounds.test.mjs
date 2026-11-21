import assert from "node:assert/strict";
import test from "node:test";
import { buildUnifiedQrOrderRounds } from "./qr-unified-order-rounds.ts";

const qrOrders = [
  { qrOrderId: 20, acceptedOrderId: 102, orderedAt: "2026-11-20T12:20:00+09:00", status: "PENDING", totalAmount: "12000" },
  { qrOrderId: 10, acceptedOrderId: null, orderedAt: "2026-11-20T12:00:00+09:00", status: "ACCEPTED", totalAmount: "10000" },
];
const qrItems = [
  { qrOrderId: 20, itemName: "김치찌개" },
  { qrOrderId: 10, itemName: "김치찌개" },
];
const posOrders = [
  { orderId: 104, orderedAt: "2026-11-20T12:30:00+09:00", status: "ACCEPTED", totalAmount: "4000" },
  { orderId: 102, orderedAt: "2026-11-20T12:21:00+09:00", status: "ACCEPTED", totalAmount: "12000" },
  { orderId: 103, orderedAt: "2026-11-20T12:10:00+09:00", status: "ACCEPTED", totalAmount: "5000" },
  { orderId: 105, orderedAt: "2026-11-20T12:40:00+09:00", status: "CANCELLED", totalAmount: "0" },
];
const posItems = [
  { orderId: 102, itemName: "승인 변환 중복" },
  { orderId: 103, itemName: "POS 직접" },
  { orderId: 104, itemName: "POS 직접 2" },
];

test("assigns one shared round sequence by intake timestamp and returns newest first", () => {
  const rounds = buildUnifiedQrOrderRounds(qrOrders, qrItems, posOrders, posItems);
  assert.deepEqual(rounds.map(round => [round.roundNumber, round.source, round.order.orderedAt]), [
    [5, "POS", "2026-11-20T12:40:00+09:00"],
    [4, "POS", "2026-11-20T12:30:00+09:00"],
    [3, "QR", "2026-11-20T12:20:00+09:00"],
    [2, "POS", "2026-11-20T12:10:00+09:00"],
    [1, "QR", "2026-11-20T12:00:00+09:00"],
  ]);
});

test("keeps QR approval and its generated POS order in one round", () => {
  const rounds = buildUnifiedQrOrderRounds(qrOrders, qrItems, posOrders, posItems);
  assert.equal(rounds.length, 5);
  assert.equal(rounds.some(round => round.source === "POS" && round.order.orderId === 102), false);
  assert.equal(rounds.some(round => round.source === "QR" && round.acceptedPosOrder?.orderId === 102), true);
});

test("uses deterministic ordering for equal timestamps and retains cancelled POS order history", () => {
  const sameTime = "2026-11-20T12:00:00+09:00";
  const rounds = buildUnifiedQrOrderRounds(
    [{ qrOrderId: 2, acceptedOrderId: null, orderedAt: sameTime }],
    [{ qrOrderId: 2 }],
    [{ orderId: 8, orderedAt: sameTime, status: "ACCEPTED" }, { orderId: 9, orderedAt: sameTime, status: "CANCELLED" }],
    [{ orderId: 8 }],
  );
  assert.deepEqual(rounds.map(round => [round.roundNumber, round.source, round.source === "QR" ? round.order.qrOrderId : round.order.orderId]), [
    [3, "POS", 9],
    [2, "POS", 8],
    [1, "QR", 2],
  ]);
});
