"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { QR_SUPPORTED_LOCALES, qrLocaleFromPreferences, type QrLocale } from "@/lib/qr-menu-cart";
import { QR_CUSTOMER_LANGUAGE_OPTIONS, QR_CUSTOMER_LANGUAGE_STORAGE_KEY, isQrCustomerLanguage } from "@/lib/qr-customer-language";

type QrCustomerLanguageContextValue = {
  locale: QrLocale;
  selectLocale: (locale: QrLocale) => void;
  openLanguageSettings: () => void;
};

const QrCustomerLanguageContext = createContext<QrCustomerLanguageContextValue | null>(null);

export function useQrCustomerLanguage() {
  const context = useContext(QrCustomerLanguageContext);
  if (!context) throw new Error("useQrCustomerLanguage must be used within QrCustomerLanguageProvider");
  return context;
}

export default function QrCustomerLanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<QrLocale>("ko");
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let saved: string | null = null;
      try { saved = window.localStorage.getItem(QR_CUSTOMER_LANGUAGE_STORAGE_KEY); } catch { /* Browser storage may be unavailable. */ }
      const browserLocale = qrLocaleFromPreferences(navigator.languages?.length ? navigator.languages : [navigator.language]);
      setLocale(isQrCustomerLanguage(saved) ? saved : browserLocale);
    }, 0);
    const onStorage = (event: StorageEvent) => {
      if (event.key === QR_CUSTOMER_LANGUAGE_STORAGE_KEY && isQrCustomerLanguage(event.newValue)) setLocale(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    if (!languageDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setLanguageDialogOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [languageDialogOpen]);

  const selectLocale = useCallback((next: QrLocale) => {
    if (!QR_SUPPORTED_LOCALES.includes(next)) return;
    setLocale(next);
    try { window.localStorage.setItem(QR_CUSTOMER_LANGUAGE_STORAGE_KEY, next); } catch { /* Keep the current-page selection if persistence is unavailable. */ }
    setLanguageDialogOpen(false);
  }, []);
  const openLanguageSettings = useCallback(() => setLanguageDialogOpen(true), []);
  const value = useMemo(() => ({ locale, selectLocale, openLanguageSettings }), [locale, selectLocale, openLanguageSettings]);

  return <QrCustomerLanguageContext.Provider value={value}>
    {children}
    {languageDialogOpen && <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" onClick={() => setLanguageDialogOpen(false)}>
      <section aria-labelledby="qr-language-title" aria-modal="true" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="dialog">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold" id="qr-language-title">언어 선택</h2>
          <button aria-label="닫기" className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 text-xl" onClick={() => setLanguageDialogOpen(false)} type="button">×</button>
        </div>
        <p className="mt-1 text-sm text-slate-600">영어·일본어·중국어 간체는 일부 메뉴 문구만 번역되어 있습니다. 주문내역 등은 한국어로 표시될 수 있습니다.</p>
        <ul className="mt-4 space-y-1">
          {QR_CUSTOMER_LANGUAGE_OPTIONS.map(option => {
            const selected = option.locale === locale;
            const disabled = option.availability === "preparing";
            return <li key={option.locale}>
              <button aria-pressed={selected} className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 text-left ${selected ? "bg-blue-50 text-blue-800" : "text-slate-800"} ${disabled ? "cursor-not-allowed opacity-55" : "active:bg-slate-100"}`}
                disabled={disabled} onClick={() => isQrCustomerLanguage(option.locale) && selectLocale(option.locale)} type="button">
                <span className="font-semibold">{option.label}</span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {option.availability === "partial" ? "일부 번역 제공" : option.availability === "preparing" ? "준비 중" : ""}
                  {selected && <svg aria-label="선택됨" className="size-5 text-blue-700" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>}
                </span>
              </button>
            </li>;
          })}
        </ul>
      </section>
    </div>}
  </QrCustomerLanguageContext.Provider>;
}
