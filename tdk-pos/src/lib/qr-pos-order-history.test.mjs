import assert from "node:assert/strict";
import test from "node:test";
import { unlinkedPosOrdersForQrSession } from "./qr-pos-order-history.ts";

const rows = [
  { orderId: 10, sessionId: 5, orderType: "POS", status: "ACCEPTED" },
  { orderId: 11, sessionId: 5, orderType: "POS", status: "ACCEPTED" },
  { orderId: 12, sessionId: 4, orderType: "POS", status: "ACCEPTED" },
  { orderId: 13, sessionId: 5, orderType: "OTHER", status: "ACCEPTED" },
  { orderId: 14, sessionId: 5, orderType: "POS", status: "CANCELLED" },
];

test("returns only current-session direct POS orders and excludes QR-linked POS rows", () => {
  assert.deepEqual(unlinkedPosOrdersForQrSession(rows, [{ acceptedOrderId: 10 }], 5), [rows[1]]);
});

test("does not resolve POS orders for an unbound QR session", () => {
  assert.deepEqual(unlinkedPosOrdersForQrSession(rows, [], null), []);
});
