"use client";

import Link from "next/link";
import { useQrCustomerLanguage } from "@/app/qr/QrCustomerLanguageProvider";
import QrFanControl from "./QrFanControl";

export const QR_BOTTOM_NAV_HEIGHT = "calc(4.5rem + 1px + env(safe-area-inset-bottom))";

const actionClass = "flex min-h-[4.5rem] min-w-0 flex-col items-center justify-center gap-0.5 transition-colors active:bg-[#E5E7EB] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gray-500";

export default function QrBottomNavigation({ menuCurrent = false, fanDisabled = false, orderDisabled = false, covered = false }: {
  menuCurrent?: boolean;
  fanDisabled?: boolean;
  orderDisabled?: boolean;
  covered?: boolean;
}) {
  const { openLanguageSettings } = useQrCustomerLanguage();
  const orderContent = <>
    <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg>
    <span className="text-[11px] leading-tight">주문하기</span>
  </>;

  return <nav aria-label="하단 메뉴" className={`fixed inset-x-0 bottom-0 z-50 mx-auto grid w-full max-w-2xl grid-cols-3 border-t border-[#D1D5DB] bg-[#F3F4F6] pb-[env(safe-area-inset-bottom)] ${covered ? "invisible" : ""}`} data-qr-bottom-nav inert={covered}>
    <button className={`${actionClass} text-slate-600`} onClick={openLanguageSettings} type="button">
      <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
      <span className="text-[11px] leading-tight">언어설정</span>
    </button>
    <QrFanControl disabled={fanDisabled} />
    {orderDisabled
      ? <button className={`${actionClass} cursor-not-allowed text-slate-400 opacity-50`} disabled type="button">{orderContent}</button>
      : <Link aria-current={menuCurrent ? "page" : undefined}
          className={`${actionClass} text-blue-700 ${menuCurrent ? "bg-blue-50 font-bold" : ""}`}
          href="/qrorder/order" prefetch={false}
          onNavigate={menuCurrent ? event => event.preventDefault() : undefined}>{orderContent}</Link>}
  </nav>;
}
