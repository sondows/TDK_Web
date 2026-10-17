"use client";

import { useState, type FormEvent } from "react";

const presets = [10, 20, 30, 60] as const;
type Selection = number | "custom";

export default function TakeoutPreparationSettingsForm({
  initialMinutes,
  maxMinutes,
}: {
  initialMinutes: number;
  maxMinutes: number;
}) {
  const initialPreset = presets.find(value => value === initialMinutes);
  const [selection, setSelection] = useState<Selection>(initialPreset ?? "custom");
  const [customMinutes, setCustomMinutes] = useState(initialPreset ? "" : String(initialMinutes));
  const [savedMinutes, setSavedMinutes] = useState(initialMinutes);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = selection === "custom" ? customMinutes.trim() : String(selection);
    const minutes = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(minutes) || minutes < 1 || minutes > maxMinutes) {
      setError(true);
      setMessage(`준비시간은 1~${maxMinutes}분의 정수로 입력하세요.`);
      return;
    }
    setSaving(true);
    setError(false);
    setMessage("");
    try {
      const response = await fetch("/api/pos-settings/takeout-preparation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      const result = await response.json() as { success?: boolean; message?: string; minutes?: number };
      if (!response.ok || !result.success) {
        setError(true);
        setMessage(result.message ?? "설정 저장에 실패했습니다.");
        return;
      }
      setSavedMinutes(result.minutes ?? minutes);
      setMessage("저장했습니다.");
    } catch {
      setError(true);
      setMessage("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return <form className="mx-auto mt-6 max-w-xl rounded-2xl bg-white p-6 shadow-sm" onSubmit={event => void save(event)}>
    <h2 className="select-none text-xl font-bold">기본 포장 준비시간</h2>
    <p className="mt-2 select-none text-sm leading-6 text-slate-500">포장 주문 생성 시 현재 시간에 자동으로 추가되는 준비시간입니다.</p>
    <div aria-label="기본 포장 준비시간 선택" className="mt-6 flex flex-wrap gap-2" role="group">
      {presets.map(minutes => <button
        aria-pressed={selection === minutes}
        className={`select-none rounded-xl border-2 px-4 py-3 font-bold transition-colors ${selection === minutes ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"}`}
        key={minutes}
        onClick={() => { setSelection(minutes); setMessage(""); }}
        type="button"
      >{minutes}분</button>)}
      <button
        aria-pressed={selection === "custom"}
        className={`select-none rounded-xl border-2 px-4 py-3 font-bold transition-colors ${selection === "custom" ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"}`}
        onClick={() => { setSelection("custom"); setMessage(""); }}
        type="button"
      >직접설정</button>
    </div>
    {selection === "custom" && <label className="mt-5 block select-none text-sm font-bold text-slate-700" htmlFor="takeout-preparation-minutes">준비시간 (분)
      <span className="mt-2 flex items-center gap-2"><input
        className="w-32 select-text rounded-lg border border-slate-300 px-3 py-2 text-right font-bold"
        id="takeout-preparation-minutes"
        inputMode="numeric"
        max={maxMinutes}
        min="1"
        onChange={event => { setCustomMinutes(event.target.value); setMessage(""); }}
        step="1"
        type="number"
        value={customMinutes}
      /><span className="select-none">분</span></span>
    </label>}
    <p className="mt-4 select-none text-sm text-slate-600">현재 저장값: {savedMinutes}분</p>
    {message && <p aria-live="polite" className={`mt-3 select-none text-sm font-medium ${error ? "text-red-700" : "text-blue-700"}`}>{message}</p>}
    <button className="mt-6 select-none rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:bg-slate-300" disabled={saving} type="submit">{saving ? "저장 중" : "저장"}</button>
  </form>;
}
