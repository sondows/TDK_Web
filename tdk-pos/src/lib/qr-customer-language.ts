import type { QrLocale } from "./qr-menu-cart";

export type QrCustomerLanguageOption = {
  locale: QrLocale | "zh-TW";
  label: string;
  availability: "ready" | "partial" | "preparing";
};

export const QR_CUSTOMER_LANGUAGE_STORAGE_KEY = "tdkon:qr-locale:v1";
const selectableLocales: readonly QrLocale[] = ["ko", "en", "zh-CN", "ja"];

export const QR_CUSTOMER_LANGUAGE_OPTIONS: QrCustomerLanguageOption[] = [
  { locale: "ko", label: "한국어", availability: "ready" },
  { locale: "en", label: "English", availability: "partial" },
  { locale: "ja", label: "日本語", availability: "partial" },
  { locale: "zh-CN", label: "简体中文", availability: "partial" },
  { locale: "zh-TW", label: "繁體中文", availability: "preparing" },
];

export function isQrCustomerLanguage(value: unknown): value is QrLocale {
  return typeof value === "string" && selectableLocales.includes(value as QrLocale);
}
