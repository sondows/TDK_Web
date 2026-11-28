import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_QR_AUTH_GUIDE, normalizeQrAuthGuideText, qrAuthGuideAssetId, qrAuthGuideImageUrl } from "./qr-auth-guide-model.ts";

test("QR authentication guide has useful defaults and needs no photo", () => {
  assert.deepEqual(DEFAULT_QR_AUTH_GUIDE, {
    title: "QR 인증하기",
    message: "매장 TV에 표시된 숫자 2자리를 입력해 주세요.",
    imageUrl: null,
  });
});

test("QR guide text fits the existing settings rows and rejects blank or oversized values", () => {
  assert.deepEqual(normalizeQrAuthGuideText(" QR 인증하기 ", " 안내 문구 "), { title: "QR 인증하기", message: "안내 문구" });
  assert.ok(normalizeQrAuthGuideText("가".repeat(80), "나".repeat(200)));
  for (const [title, message] of [[" ", "안내"], ["제목", ""], ["가".repeat(81), "안내"], ["제목", "나".repeat(201)], [1, "안내"]]) {
    assert.equal(normalizeQrAuthGuideText(title, message), null);
  }
});

test("authentication guide images use an isolated UUID path", () => {
  const id = "d3519cb2-c301-451e-b3aa-888682bbb641";
  assert.ok(qrAuthGuideAssetId.test(id));
  assert.ok(!qrAuthGuideAssetId.test("../menu.webp"));
  assert.equal(qrAuthGuideImageUrl(id), `/api/qr/order-auth/guide-image/${id}`);
});
