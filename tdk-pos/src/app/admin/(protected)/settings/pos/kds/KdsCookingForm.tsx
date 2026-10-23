"use client";

import { useState } from "react";
import { DEFAULT_KDS_COOKING_SETTINGS, type KdsCookingSettings } from "@/lib/kds-model";

export default function KdsCookingForm({ initial }: { initial: KdsCookingSettings }) {
  const [settings, setSettings] = useState(initial ?? DEFAULT_KDS_COOKING_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function changeOption(index: number, value: number) {
    setSettings(current => {
      const options = [...current.boilTimeOptions] as KdsCookingSettings["boilTimeOptions"];
      options[index] = value;
      return { ...current, boilTimeOptions: options };
    });
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/kds-cooking", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
      });
      const result = await response.json() as { success?: boolean; message?: string; settings?: KdsCookingSettings };
      if (!response.ok || !result.success || !result.settings) throw new Error(result.message ?? "설정을 저장하지 못했습니다.");
      setSettings(result.settings);
      setMessage("외부 끓임 시간 설정을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-bold text-slate-800">외부 끓임 시간 설정</h2>
    <p className="mt-1 text-sm text-slate-600">조리 완료 요청 시 김치찌개류에 표시할 외부 끓임 시간 선택값입니다.</p>
    <div className="mt-4 grid grid-cols-3 gap-3">
      {settings.boilTimeOptions.map((minutes, index) => <label className="text-sm font-semibold text-slate-700" key={index}>
        시간 버튼 {index + 1} (분)
        <input className="mt-1 h-10 w-full rounded border border-slate-300 px-3" inputMode="numeric" max={60} min={1} onChange={event => changeOption(index, Number(event.target.value))} type="number" value={minutes} />
      </label>)}
    </div>
    <label className="mt-3 block text-sm font-semibold text-slate-700">기본 선택
      <select className="mt-1 h-10 w-full rounded border border-slate-300 bg-white px-3" onChange={event => setSettings(current => ({ ...current, defaultBoilTimeMinutes: Number(event.target.value) }))} value={settings.defaultBoilTimeMinutes}>
        {settings.boilTimeOptions.map((minutes, index) => <option key={`${index}-${minutes}`} value={minutes}>{minutes}분</option>)}
      </select>
    </label>
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    <button className="mt-4 min-h-10 rounded bg-slate-700 px-4 font-semibold text-white hover:bg-slate-800 disabled:opacity-50" disabled={saving} onClick={() => void save()} type="button">{saving ? "저장 중…" : "설정 저장"}</button>
  </section>;
}
