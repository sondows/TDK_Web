import assert from "node:assert/strict";
import test from "node:test";
import { qrOrderIssuedTimeLabel, qrOrderPeopleLabel, sortQrOrderTables } from "./qr-orders-list-model.ts";

const item = (tableId, issuedAt, overrides = {}) => ({
  tableId, tableNo: String(tableId), issuedAt, adultCount: null, babyCount: null,
  hasActiveQrToken: true, hasPendingQrOrder: false, ...overrides,
});

test("QR tables are ordered by token issuance time, removing expired idle tokens but retaining pending orders", () => {
  assert.deepEqual(sortQrOrderTables([
    item(3, "2026-11-18 17:35:00"),
    item(2, "2026-11-18 17:30:00", { hasActiveQrToken: false }),
    item(4, "2026-11-18 17:20:00", { hasActiveQrToken: false, hasPendingQrOrder: true }),
    item(1, "2026-11-18 17:30:00"),
  ]).map(row => row.tableId), [4, 1, 3]);
});

test("registered adult and child counts omit child zero and unentered counts stay explicit", () => {
  assert.equal(qrOrderPeopleLabel(null, null), "인원 미입력");
  assert.equal(qrOrderPeopleLabel(0, 0), "인원 미입력");
  assert.equal(qrOrderPeopleLabel(2, 0), "성인 2 /");
  assert.equal(qrOrderPeopleLabel(2, 1), "성인 2 / 아동 1");
});

test("issuance time label uses the stored table-local time", () => {
  assert.equal(qrOrderIssuedTimeLabel("2026-11-18 17:30:00"), "17:30");
  assert.equal(qrOrderIssuedTimeLabel("invalid"), "--:--");
});
