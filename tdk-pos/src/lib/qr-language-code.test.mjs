import assert from "node:assert/strict";
import test from "node:test";

import { toQrLanguageDisplayCode } from "./qr-language-code.ts";

test("Korean QR locale has no secondary language code", () => {
  assert.equal(toQrLanguageDisplayCode("ko-KR"), null);
});

test("QR locale values become compact display codes", () => {
  assert.equal(toQrLanguageDisplayCode("en-US"), "EN");
  assert.equal(toQrLanguageDisplayCode("ja-JP"), "JP");
  assert.equal(toQrLanguageDisplayCode("zh-CN"), "CN");
  assert.equal(toQrLanguageDisplayCode("fr-FR"), "FR");
});
