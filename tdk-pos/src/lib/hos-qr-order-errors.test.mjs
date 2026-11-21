import assert from "node:assert/strict";
import test from "node:test";
import { getHosQrOrderNetworkError, getHosQrOrderResponseError } from "./hos-qr-order-errors.ts";

test("QR order response errors distinguish auth, permission, server, and operation errors", () => {
  assert.match(getHosQrOrderResponseError(401, null, "load"), /로그인/);
  assert.match(getHosQrOrderResponseError(403, null, "decision"), /권한/);
  assert.match(getHosQrOrderResponseError(503, "internal detail", "load"), /서버 오류/);
  assert.equal(getHosQrOrderResponseError(409, "이미 처리된 주문입니다.", "decision"), "이미 처리된 주문입니다.");
  assert.match(getHosQrOrderResponseError(400, null, "load"), /목록/);
  assert.match(getHosQrOrderResponseError(400, null, "decision"), /처리/);
});

test("QR order network errors are action-specific", () => {
  assert.match(getHosQrOrderNetworkError("load"), /네트워크/);
  assert.match(getHosQrOrderNetworkError("decision"), /네트워크/);
  assert.notEqual(getHosQrOrderNetworkError("load"), getHosQrOrderNetworkError("decision"));
});
