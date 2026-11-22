import assert from "node:assert/strict";
import test from "node:test";
import { qrCustomerRedirectUrl } from "./qr-customer-redirect.ts";

test("production QR redirects keep the public HTTPS origin even with an internal request URL", () => {
  const previous = process.env.NODE_ENV;
  const previousBase = process.env.QR_PUBLIC_BASE_URL;
  process.env.NODE_ENV = "production";
  delete process.env.QR_PUBLIC_BASE_URL;
  try {
    const request = new Request("http://192.168.0.83:3000/tdkqrs/23456789ABCDEFGH");
    assert.equal(qrCustomerRedirectUrl(request, "/qrorder/order").toString(), "https://tdkon.myasustor.com/qrorder/order");
    assert.equal(qrCustomerRedirectUrl(request, "/tdkqrs/23456789ABCDEFGH").toString(), "https://tdkon.myasustor.com/tdkqrs/23456789ABCDEFGH");
    process.env.QR_PUBLIC_BASE_URL = "http://192.168.0.83:3000";
    assert.throws(() => qrCustomerRedirectUrl(request, "/qrorder/order"), /QR_PUBLIC_BASE_URL/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    if (previousBase === undefined) delete process.env.QR_PUBLIC_BASE_URL; else process.env.QR_PUBLIC_BASE_URL = previousBase;
  }
});
