import assert from "node:assert/strict";
import test from "node:test";
import { formatQrManagementNumber, qrIssueDateInSeoul } from "./qr-management-number.ts";

test("QR issue date follows the Seoul calendar across UTC midnight", () => {
  assert.equal(qrIssueDateInSeoul(new Date("2026-11-15T15:00:00.000Z")), "2026-11-16");
  assert.equal(qrIssueDateInSeoul(new Date("2026-11-16T14:59:59.999Z")), "2026-11-16");
  assert.equal(qrIssueDateInSeoul(new Date("2026-11-16T15:00:00.000Z")), "2026-11-17");
});

test("QR serials are padded to at least four digits and expand above 9999", () => {
  assert.equal(formatQrManagementNumber("2026-11-16", 1), "20261116-0001");
  assert.equal(formatQrManagementNumber("2026-11-16", 9), "20261116-0009");
  assert.equal(formatQrManagementNumber("2026-11-16", 9999), "20261116-9999");
  assert.equal(formatQrManagementNumber("2026-11-16", 10000), "20261116-10000");
});

test("QR serial formatting rejects invalid dates and serials", () => {
  assert.throws(() => formatQrManagementNumber("2026-11-16", 0), RangeError);
  assert.throws(() => formatQrManagementNumber("2026-11-16", 4_294_967_296), RangeError);
  assert.throws(() => formatQrManagementNumber("20261116", 1), RangeError);
  assert.throws(() => formatQrManagementNumber("2026-02-30", 1), RangeError);
});
