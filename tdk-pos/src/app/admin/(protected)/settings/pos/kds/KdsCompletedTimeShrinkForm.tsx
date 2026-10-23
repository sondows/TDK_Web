"use client";

import { useState } from "react";
import { DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES, isKdsCompletedTimeShrinkStartMinutes } from "@/lib/kds-model";

export default function KdsCompletedTimeShrinkForm({ initialMinutes }: { initialMinutes: number }) {
  const [minutes, setMinutes] = useState(String(initialMinutes ?? DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const numericMinutes = minutes.trim() === "" ? Number.NaN : Number(minutes);
  const valid = isKdsCompletedTimeShrinkStartMinutes(numericMinutes);

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/kds-completed-time-shrink", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutes: numericMinutes }),
      });
      const result = await response.json() as { success?: boolean; message?: string; minutes?: number };
      if (!response.ok || !result.success || !isKdsCompletedTimeShrinkStartMinutes(result.minutes)) {
        throw new Error(result.message ?? "설정을 저장하지 못했습니다.");
      }
      setMinutes(String(result.minutes));
      setMessage("완료시간 글씨 축소 설정을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-bold text-slate-800">완료시간 글씨 축소 설정</h2>
    <p className="mt-1 text-sm text-slate-600">조리완료 후 지정한 시간이 지나면 완료시간 숫자가 1분마다 작아지며, 5분 뒤에는 (조리완료) 글씨와 같은 크기가 됩니다.</p>
    <label className="mt-4 block text-sm font-semibold text-slate-700">글씨 축소 시작시간 (분)
      <input aria-invalid={!valid} className="mt-1 h-10 w-full rounded border border-slate-300 px-3" inputMode="numeric" max={120} min={0} onChange={event => { setMinutes(event.target.value); setMessage(""); }} step={1} type="number" value={minutes} />
    </label>
    {!valid && <p className="mt-2 text-sm text-red-600" role="alert">0~120분 사이의 정수를 입력해 주세요.</p>}
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    <button className="mt-4 min-h-10 rounded bg-slate-700 px-4 font-semibold text-white hover:bg-slate-800 disabled:opacity-50" disabled={saving || !valid} onClick={() => void save()} type="button">{saving ? "저장 중" : "설정 저장"}</button>
  </section>;
}
