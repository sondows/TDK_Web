import assert from "node:assert/strict";
import test from "node:test";
import { aggregateQrOrderItems, hasQrOrderHistory, totalQrOrderAmount } from "./qr-order-history-model.ts";

test("QR history exists for any submitted order, including employee-review and cancelled records", () => {
  assert.equal(hasQrOrderHistory([]), false);
  assert.equal(hasQrOrderHistory([{ status: "PENDING" }]), true);
  assert.equal(hasQrOrderHistory([{ status: "CANCELLED" }]), true);
});

test("QR order summary combines billable lines by menu ID, not option or displayed name", () => {
  const orders = [
    { qrOrderId: 1, status: "ACCEPTED", totalAmount: "24000" },
    { qrOrderId: 2, status: "PENDING", totalAmount: "5000" },
    { qrOrderId: 3, status: "REJECTED", totalAmount: "99000" },
    { qrOrderId: 4, status: "CANCELLED", totalAmount: "7000" },
  ];
  const items = [
    { qrOrderId: 1, menuId: 10, itemName: "김치찌개", qty: 1, totalAmount: "10000", optionName: "순한맛" },
    { qrOrderId: 1, menuId: 10, itemName: "김치찌개", qty: 1, totalAmount: "10000", optionName: "매운맛" },
    { qrOrderId: 1, menuId: 11, itemName: "김치찌개", qty: 1, totalAmount: "4000" },
    { qrOrderId: 2, menuId: 10, itemName: "김치찌개", qty: 1, totalAmount: "5000" },
    { qrOrderId: 3, menuId: 10, itemName: "김치찌개", qty: 9, totalAmount: "99000" },
    { qrOrderId: 4, menuId: 10, itemName: "김치찌개", qty: 1, totalAmount: "7000" },
  ];

  assert.deepEqual(aggregateQrOrderItems(orders, items), [
    { menuId: 10, itemName: "김치찌개", qty: 3, totalAmount: 25000 },
    { menuId: 11, itemName: "김치찌개", qty: 1, totalAmount: 4000 },
  ]);
  assert.equal(totalQrOrderAmount(orders), 29000);
});
