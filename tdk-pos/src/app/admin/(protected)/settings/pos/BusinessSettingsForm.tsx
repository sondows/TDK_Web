"use client";

import { useState } from "react";
import { isValidCutoffTime } from "@/lib/business-date";

export default function BusinessSettingsForm({ initialCutoffTime = "06:00", initialOpeningCashEnabled = false }: {
  initialCutoffTime?: string;
  initialOpeningCashEnabled?: boolean;
}) {
  const [cutoffHour, initialCutoffMinute = "00"] = initialCutoffTime.split(":");
  const [hour, setHour] = useState(cutoffHour);
  const [minute, setMinute] = useState(initialCutoffMinute);
  const [openingCashEnabled, setOpeningCashEnabled] = useState(initialOpeningCashEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save(pointerActivatedButton: HTMLButtonElement | null = null) {
    const cutoffTime = `${hour}:${minute}`;
    if (!isValidCutoffTime(cutoffTime)) {
      setMessage("영업일 기준시간을 확인해 주세요.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/pos-settings/business-day", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cutoffTime, openingCashEnabled }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      setMessage(response.ok && result.success
        ? "저장했습니다. 변경 내용은 다음 영업 시작부터 적용됩니다."
        : result.message ?? "저장에 실패했습니다.");
    } catch {
      setMessage("저장에 실패했습니다.");
    } finally {
      setBusy(false);
      pointerActivatedButton?.blur();
    }
  }

  return <section className="mt-5 rounded-2xl bg-white p-6 shadow-sm">
    <>
      <div>
        <span className="block text-sm font-bold" id="business-day-cutoff-label">영업일 기준시간</span>
        <div aria-describedby="business-day-cutoff-description business-day-cutoff-note" aria-labelledby="business-day-cutoff-label" className="mt-2 flex min-h-11 items-center gap-2">
          <select aria-label="영업일 기준시간 시" className="min-h-11 w-20 rounded-lg border border-slate-300 bg-white px-3 text-base" onChange={event => setHour(event.target.value)} value={hour}>
            {Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0")).map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <span aria-hidden="true" className="text-base font-bold">:</span>
          <select aria-label="영업일 기준시간 분" className="min-h-11 w-20 rounded-lg border border-slate-300 bg-white px-3 text-base" onChange={event => setMinute(event.target.value)} value={minute}>
            {[...new Set(["00", "10", "20", "30", "40", "50", minute])].sort().map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-600" id="business-day-cutoff-description">설정한 시간 이전의 판매는 전날 영업으로 처리됩니다.</p>
      <p className="mt-1 text-xs text-slate-500" id="business-day-cutoff-note">영업 중 기준시간이 지나도 자동으로 마감되지는 않습니다.</p>
      <div className="mt-6 border-t border-slate-200 pt-5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-bold" id="opening-cash-setting-label">시재등록</span>
          <button
            aria-checked={openingCashEnabled}
            aria-labelledby="opening-cash-setting-label"
            className={`relative inline-flex h-8 w-[74px] shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${openingCashEnabled ? "bg-blue-600" : "bg-slate-300"}`}
            onClick={() => setOpeningCashEnabled(value => !value)}
            role="switch"
            type="button"
          >
            <span aria-hidden="true" className={`absolute left-1 inline-block size-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${openingCashEnabled ? "translate-x-[42px]" : "translate-x-0"}`} />
            <span aria-hidden="true" className={`absolute left-2 z-10 text-[11px] font-bold ${openingCashEnabled ? "text-white" : "text-transparent"}`}>ON</span>
            <span aria-hidden="true" className={`absolute right-2 z-10 text-[11px] font-bold ${openingCashEnabled ? "text-transparent" : "text-slate-600"}`}>OFF</span>
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-600">새로운 영업을 시작할 때 시작 시재를 입력합니다.</p>
        <p className="mt-1 text-xs text-slate-500">변경 사항은 다음 새 영업 시작부터 적용됩니다.</p>
      </div>
    </>
    {message && <p className="mt-4 text-sm text-blue-700" role="status">{message}</p>}
    <button className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" disabled={busy} onClick={event => void save(event.detail > 0 ? event.currentTarget : null)} type="button">{busy ? "저장 중" : "저장"}</button>
  </section>;
}
