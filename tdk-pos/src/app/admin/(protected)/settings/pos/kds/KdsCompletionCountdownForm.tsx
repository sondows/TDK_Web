"use client";

import { useState } from "react";
import { DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS, isKdsCompletionCountdownSeconds } from "@/lib/kds-model";

export default function KdsCompletionCountdownForm({ initialSeconds }: { initialSeconds: number }) {
  const [seconds, setSeconds] = useState(String(initialSeconds ?? DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const numericSeconds = seconds.trim() === "" ? Number.NaN : Number(seconds);
  const valid = isKdsCompletionCountdownSeconds(numericSeconds);

  async function save() {
    if (!valid || saving) {
      setMessage("완료 카운트다운은 1~30초 정수로 설정해 주세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/kds-completion-countdown", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seconds: numericSeconds }),
      });
      const result = await response.json() as { success?: boolean; message?: string; seconds?: number };
      if (!response.ok || !result.success || !isKdsCompletionCountdownSeconds(result.seconds)) {
        throw new Error(result.message ?? "설정을 저장하지 못했습니다.");
      }
      setSeconds(String(result.seconds));
      setMessage("조리완료 카운트다운 설정을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-bold text-slate-800">조리완료 카운트다운 설정</h2>
    <p className="mt-1 text-sm text-slate-600">KDS에서 조리완료를 요청한 후 완료가 확정되기까지의 카운트다운 시간을 설정합니다.</p>
    <label className="mt-4 block text-sm font-semibold text-slate-700">완료 카운트다운 시간 (초)
      <input aria-invalid={!valid} className="mt-1 h-10 w-full rounded border border-slate-300 px-3" inputMode="numeric" max={30} min={1} onChange={event => { setSeconds(event.target.value); setMessage(""); }} step={1} type="number" value={seconds} />
    </label>
    {!valid && <p className="mt-2 text-sm text-red-600" role="alert">1~30초 사이의 정수를 입력해 주세요.</p>}
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    <button className="mt-4 min-h-10 rounded bg-slate-700 px-4 font-semibold text-white hover:bg-slate-800 disabled:opacity-50" disabled={saving || !valid} onClick={() => void save()} type="button">{saving ? "저장 중…" : "설정 저장"}</button>
  </section>;
}
