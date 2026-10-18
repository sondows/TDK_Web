"use client";

import { useState } from "react";

export default function BusinessSettingsForm({ initialCutoffTime, initialOpeningCashEnabled }: {
  initialCutoffTime: string; initialOpeningCashEnabled: boolean;
}) {
  const [cutoffTime, setCutoffTime] = useState(initialCutoffTime);
  const [openingCashEnabled, setOpeningCashEnabled] = useState(initialOpeningCashEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pos-settings/business-day", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cutoffTime, openingCashEnabled }) });
      const result = await response.json() as { success?: boolean; message?: string };
      setMessage(response.ok && result.success ? "저장했습니다. 변경 내용은 다음 영업세션부터 적용됩니다." : result.message ?? "저장에 실패했습니다.");
    } catch { setMessage("저장에 실패했습니다."); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 rounded-2xl bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold">영업일과 준비금</h2>
    <p className="mt-2 text-sm text-slate-500">진행 중인 영업은 마감 전까지 같은 영업일을 유지합니다.</p>
    <label className="mt-5 block text-sm font-bold">영업일 전환 기준시간
      <input className="mt-2 block rounded-lg border border-slate-300 px-3 py-2" onChange={event => setCutoffTime(event.target.value)} type="time" value={cutoffTime} />
    </label>
    <label className="mt-5 flex items-center gap-3 text-sm font-bold"><input checked={openingCashEnabled} onChange={event => setOpeningCashEnabled(event.target.checked)} type="checkbox" />준비금 사용</label>
    {message && <p className="mt-4 text-sm text-blue-700" role="status">{message}</p>}
    <button className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void save()} type="button">{busy ? "저장 중" : "저장"}</button>
  </section>;
}
