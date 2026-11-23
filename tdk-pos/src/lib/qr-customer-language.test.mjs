import test from "node:test";
import assert from "node:assert/strict";
import { QR_LOCALE_STORAGE_KEY } from "./qr-menu-cart.ts";
import { QR_CUSTOMER_LANGUAGE_OPTIONS, QR_CUSTOMER_LANGUAGE_STORAGE_KEY, isQrCustomerLanguage } from "./qr-customer-language.ts";

test("customer language choices stay ordered and use the existing locale preference key", () => {
  assert.deepEqual(QR_CUSTOMER_LANGUAGE_OPTIONS.map(option => option.label), ["한국어", "English", "日本語", "简体中文", "繁體中文"]);
  assert.equal(QR_CUSTOMER_LANGUAGE_STORAGE_KEY, QR_LOCALE_STORAGE_KEY);
  assert.deepEqual(QR_CUSTOMER_LANGUAGE_OPTIONS.map(option => option.availability), ["ready", "partial", "partial", "partial", "preparing"]);
});

test("only locales with existing customer menu resources can be selected", () => {
  for (const locale of ["ko", "en", "ja", "zh-CN"]) assert.equal(isQrCustomerLanguage(locale), true);
  assert.equal(isQrCustomerLanguage("zh-TW"), false);
  assert.equal(isQrCustomerLanguage("fr"), false);
});
