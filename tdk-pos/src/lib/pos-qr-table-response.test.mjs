import assert from "node:assert/strict";
import test from "node:test";
import { readPosQrTableResponse } from "./pos-qr-table-response.ts";

test("POS QR orders distinguish access errors from an empty successful list", async () => {
  const denied = new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain" } });
  await assert.rejects(readPosQrTableResponse(denied, "테이블 QR 주문 조회"), /권한이 거부.*403/);
  const expired = Response.json({ success: false }, { status: 401 });
  await assert.rejects(readPosQrTableResponse(expired, "테이블 QR 주문 조회"), /로그인 정보가 만료/);
  const empty = Response.json({ success: true, orders: [] });
  assert.deepEqual((await readPosQrTableResponse(empty, "테이블 QR 주문 조회")).orders, []);
});

test("POS QR orders reject non-JSON and server failures without showing response bodies", async () => {
  await assert.rejects(readPosQrTableResponse(new Response("internal secret", { status: 503, headers: { "content-type": "text/plain" } }), "테이블 QR 주문 조회"), error => {
    assert.match(error.message, /응답 형식.*503/);
    assert.doesNotMatch(error.message, /internal secret/);
    return true;
  });
  await assert.rejects(readPosQrTableResponse(Response.json({ success: false, message: "조회 실패" }, { status: 503 }), "테이블 QR 주문 조회"), /조회 실패/);
});
