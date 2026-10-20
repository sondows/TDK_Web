"use client";

import { useRef, useState } from "react";

export default function BusinessSettingsForm({ initialOpeningCashEnabled = false }: {
  initialOpeningCashEnabled?: boolean;
}) {
  const [openingCashEnabled, setOpeningCashEnabled] = useState(initialOpeningCashEnabled);
  const savedOpeningCashEnabled = useRef(initialOpeningCashEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saveFailed, setSaveFailed] = useState(false);

  async function save(pointerActivatedButton: HTMLButtonElement | null = null) {
    setBusy(true);
    setMessage("");
    setSaveFailed(false);
    try {
      const response = await fetch("/api/pos-settings/business-day", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingCashEnabled }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      const succeeded = response.ok && result.success;
      setSaveFailed(!succeeded);
      if (succeeded) savedOpeningCashEnabled.current = openingCashEnabled;
      else setOpeningCashEnabled(savedOpeningCashEnabled.current);
      setMessage(succeeded ? "저장했습니다. 다음 날짜의 첫 판매부터 적용됩니다." : result.message ?? "저장에 실패했습니다.");
    } catch {
      setOpeningCashEnabled(savedOpeningCashEnabled.current);
      setSaveFailed(true);
      setMessage("저장에 실패했습니다.");
    } finally {
      setBusy(false);
      pointerActivatedButton?.blur();
    }
  }

  return <section className="mt-5 rounded-2xl bg-white p-6 shadow-sm">
    <>
      <div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-bold" id="opening-cash-setting-label">준비금 사용</span>
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
        <p className="mt-2 text-sm text-slate-600">해당 날짜의 첫 판매 활동 전에 시작 준비금을 입력합니다.</p>
        <p className="mt-1 text-xs text-slate-500">등록된 날짜의 준비금은 새로고침이나 재마감 후에도 유지됩니다.</p>
      </div>
    </>
    {message && <p className={`mt-4 text-sm ${saveFailed ? "text-red-700" : "text-blue-700"}`} role={saveFailed ? "alert" : "status"}>{message}</p>}
    <button className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700" disabled={busy} onClick={event => void save(event.detail > 0 ? event.currentTarget : null)} type="button">{busy ? "저장 중" : "저장"}</button>
  </section>;
}
