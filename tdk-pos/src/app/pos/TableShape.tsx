"use client";

import { useEffect, useState, type PointerEventHandler } from "react";
import { formatMoney } from "@/lib/format-money";
import { formatSessionElapsed } from "@/lib/session-time";
import { tableLayoutStyle, type TableLayoutValues } from "@/lib/table-layout";

type Props = TableLayoutValues & { tableNumber: string; guestCount: number; amountDue: number; prepaidAmount?: number; customerName?: string | null; startedAt: string | null; hasOpenSession?: boolean; sageOccupied?: boolean; hasQrOrder?: boolean; qrLanguageCode?: string | null; mergedSourceTableNos?: string[]; mergeSplitCandidate?: boolean; mergeSplitSelected?: boolean; scale?: number; enhancedText?: boolean; dataTableManagementItem?: boolean; grouped?: boolean; blocked?: boolean; partyGroupBadge?: number | null; partyGroupColor?: string; partyGroupSelected?: boolean; partyHighlight?: boolean; thickSelection?: boolean; selected?: boolean; editable?: boolean; onClick?: () => void; onPointerDown?: PointerEventHandler<HTMLButtonElement>; onResizePointerDown?: PointerEventHandler<HTMLSpanElement> };

export default function TableShape({ tableNumber, guestCount, amountDue, prepaidAmount = 0, customerName = null, startedAt, hasOpenSession, sageOccupied = false, hasQrOrder = false, qrLanguageCode = null, mergedSourceTableNos = [], mergeSplitCandidate = false, mergeSplitSelected = false, scale = 1, enhancedText = false, dataTableManagementItem = false, grouped = false, blocked = false, partyGroupBadge = null, partyGroupColor, partyGroupSelected = false, partyHighlight = false, thickSelection = false, selected = false, editable = false, onClick, onPointerDown, onResizePointerDown, ...layout }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const occupied = hasOpenSession ?? (guestCount > 0 && startedAt !== null);
  const fixedTextLayout = !dataTableManagementItem;
  const activeChairs = occupied ? Math.min(4, guestCount) : 0;
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const chairs = [{ side: "top", slot: "left", active: activeChairs >= 4 }, { side: "top", slot: "right", active: activeChairs >= 1 }, { side: "bottom", slot: "right", active: activeChairs >= 2 }, { side: "bottom", slot: "left", active: activeChairs >= 3 }];
  const numberClass = occupied ? (enhancedText ? "text-2xl leading-none text-slate-800" : "text-lg leading-none text-slate-800") : (enhancedText ? "text-2xl leading-none text-slate-700" : "text-2xl leading-none text-slate-700");
  const amountClass = enhancedText ? "h-4 text-sm font-bold leading-4 text-slate-700" : "h-4 text-[11px] font-bold leading-4 text-slate-700";
  const detailsClass = enhancedText ? "h-4 text-xs font-medium leading-4 text-slate-500" : "h-4 text-[9px] font-medium leading-4 text-slate-500";
  const mainOccupied = fixedTextLayout && occupied;
  const useSageSurface = sageOccupied && occupied;
  const baseStyle = tableLayoutStyle(layout);
  const tableStyle = scale === 1 ? baseStyle : { ...baseStyle, transform: `${baseStyle.transform} scale(${scale})`, transformOrigin: "center" };
  const partyBorderStyle = partyGroupColor ? { borderColor: partyGroupColor, ...(partyGroupSelected ? { boxShadow: `0 0 0 3px ${partyGroupColor}55` } : {}) } : undefined;
  const surfaceStyle = {
    ...partyBorderStyle,
    ...(useSageSurface ? {
      backgroundImage: "none",
      backgroundColor: "#E8F3EC",
      ...(!selected && !partyGroupColor ? { borderColor: "#A9BEB2" } : {}),
    } : {}),
  };
  return <button aria-label={`${tableNumber}번 테이블`} data-table-management-item={dataTableManagementItem ? "true" : undefined} className={`absolute overflow-visible ${editable ? "touch-none" : ""} ${selected ? "z-10" : ""}`} onClick={onClick} onPointerDown={onPointerDown} style={tableStyle} type="button">
    {chairs.map((chair, index) => <span key={index} className={`absolute h-[18%] w-[24%] rounded-md border shadow-sm transition-transform ${chair.active ? (sageOccupied ? "border-[#789487] bg-[#789487] shadow-[0_1px_2px_rgba(120,148,135,0.2)]" : "border-amber-700 bg-amber-600 shadow-amber-900/20") : "border-slate-200 bg-slate-100"} ${chair.side === "top" ? (chair.active ? "top-[0.5%]" : "top-[6%]") : (chair.active ? "bottom-[0.5%]" : "bottom-[6%]")} ${chair.slot === "left" ? "left-[17%]" : "right-[17%]"}`} />)}
    <span className={`absolute inset-x-[7%] inset-y-[15%] z-10 flex flex-col items-center ${mainOccupied ? "" : "justify-center"} rounded-[20px] border [box-sizing:border-box] ${useSageSurface ? "" : "bg-[linear-gradient(135deg,#ffffff_0%,#f1f5f9_47%,#ffffff_100%)]"} shadow-[0_5px_11px_rgba(15,23,42,0.14)] ${mergeSplitSelected ? "border-[5px] border-violet-600 ring-2 ring-violet-200 shadow-violet-900/20" : mergeSplitCandidate ? "border-[3px] border-violet-500 ring-1 ring-violet-200" : selected ? (partyGroupColor ? "border-[5px]" : dataTableManagementItem || partyHighlight || thickSelection ? "border-[3px] border-emerald-500 ring-2 ring-emerald-200 shadow-emerald-900/15" : "border-emerald-500 ring-2 ring-emerald-200 shadow-emerald-900/15") : blocked ? "border-[3px] border-red-500 ring-1 ring-red-200" : grouped ? (partyGroupColor ? "border-[3px]" : "border-[3px] border-sky-400 ring-1 ring-sky-200") : "border-slate-200"}`} style={surfaceStyle}>
      {partyGroupBadge !== null && <span aria-label={`일행 그룹 ${partyGroupBadge}`} className="absolute -right-3 -top-3 z-20 flex size-9 items-center justify-center rounded-full text-lg font-extrabold text-white shadow-md" style={{ backgroundColor: partyGroupColor ?? "#0284C7" }}>{partyGroupBadge}</span>}
      {mainOccupied ? (
        <span className="pos-table-occupied-content">
          <span className="pos-table-occupied-label">
            <strong className={`text-2xl leading-none text-slate-800 ${tableNumber.length > 1 ? "pos-table-occupied-number-multi" : ""} whitespace-nowrap font-bold`}>{tableNumber}</strong>
            {hasQrOrder && <span aria-label={`QR 주문${qrLanguageCode ? ` ${qrLanguageCode}` : ""}`} className="pos-table-qr-marker pos-table-qr-order-marker">QR</span>}
            {hasQrOrder && qrLanguageCode && <span className="pos-table-qr-marker pos-table-qr-language-marker">{qrLanguageCode}</span>}
          </span>
          <span className="pos-table-occupied-info">
            <span className="pos-table-occupied-general">
              <span className={`${amountClass} pos-table-occupied-amount pos-table-info-row whitespace-nowrap`}>= {formatMoney(amountDue)}</span>
              {prepaidAmount > 0 && <span className={`${amountClass} pos-table-occupied-amount pos-table-info-row whitespace-nowrap !text-blue-600`}>- {formatMoney(prepaidAmount)}</span>}
              <span className={`${detailsClass} pos-table-occupied-usage pos-table-info-row whitespace-nowrap`}>{formatSessionElapsed(startedAt ?? new Date().toISOString(), now)} ({guestCount}명)</span>
              {customerName?.trim() && <span className={`${detailsClass} pos-table-occupied-customer pos-table-info-row max-w-full truncate whitespace-nowrap`}>{customerName.trim()}</span>}
            </span>
            {mergedSourceTableNos.length > 0 && <span className="pos-table-merge-line"><span className={`pos-table-merge-badge max-w-[92%] truncate rounded-full bg-violet-100 px-[7px] py-[2px] font-bold text-violet-700 ${enhancedText ? "text-[10px]" : "text-[8px]"}`}>합석 {mergedSourceTableNos.map(tableNo => `+${tableNo}T`).join(" ")}</span></span>}
          </span>
        </span>
      ) : (
        <>
          <strong className={numberClass}>{tableNumber}</strong>
          {occupied && <><span className={amountClass}>= {formatMoney(amountDue)}</span>{prepaidAmount > 0 && <span className={`${amountClass} mt-0 !text-blue-600`}>- {formatMoney(prepaidAmount)}</span>}<span className={detailsClass}>{guestCount}명 · {formatSessionElapsed(startedAt ?? new Date().toISOString(), now)}</span></>}
          {mergedSourceTableNos.length > 0 && <span className={`mt-0.5 max-w-[92%] truncate rounded-full bg-violet-100 px-1.5 py-px font-bold text-violet-700 ${enhancedText ? "text-[10px]" : "text-[8px]"}`}>합석 {mergedSourceTableNos.map(tableNo => `+${tableNo}T`).join(" ")}</span>}
        </>
      )}
    </span>
    <span aria-label="크기 조절" className={`absolute -bottom-3 -right-3 h-7 w-7 rounded-full border-2 border-white bg-emerald-600 shadow ${editable && selected ? "opacity-100" : "pointer-events-none opacity-0"}`} data-resize="true" onPointerDown={onResizePointerDown} />
  </button>;
}
