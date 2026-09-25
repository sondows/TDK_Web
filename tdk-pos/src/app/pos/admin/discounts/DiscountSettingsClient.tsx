"use client";

import { useState } from "react";

type PersistedPreset = { slot: number | null; title: string; type: "RATE" | "AMOUNT" | "FREE_ITEM"; value: string; isActive: number };
type Preset = { slot: number; title: string; type: "AMOUNT" | "PERCENT"; value: string; isActive: boolean };

const emptyPresets = (items: PersistedPreset[]): Preset[] => [1, 2, 3, 4].map(slot => {
  const preset = items.find(item => item.slot === slot);
  return preset ? { slot, title: preset.title, type: preset.type === "RATE" ? "PERCENT" : "AMOUNT", value: String(Number(preset.value)), isActive: preset.isActive === 1 } : { slot, title: "", type: "AMOUNT", value: "", isActive: false };
});

export default function DiscountSettingsClient({ initialPresets }: { initialPresets: PersistedPreset[] }) {
  const [presets, setPresets] = useState(() => emptyPresets(initialPresets));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const update = (slot: number, patch: Partial<Preset>) => setPresets(current => current.map(preset => preset.slot === slot ? { ...preset, ...patch } : preset));
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/admin/discount-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presets: presets.map(preset => ({ ...preset, value: Number(preset.value) })) }) });
      const result = await response.json() as { success?: boolean; message?: string; presets?: PersistedPreset[] };
      if (!response.ok || !result.success || !result.presets) throw new Error(result.message ?? "할인 설정을 저장할 수 없습니다.");
      setPresets(emptyPresets(result.presets)); setMessage("할인 설정을 저장했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "할인 설정을 저장할 수 없습니다."); } finally { setSaving(false); }
  };
  return <section className="mx-auto mt-6 max-w-3xl rounded-2xl bg-white p-6 shadow-sm"><p className="text-sm text-slate-500">POS 할인 화면에 표시할 빠른 할인 버튼을 최대 4개까지 설정할 수 있습니다.</p><div className="mt-5 space-y-5">{presets.map(preset => <section className="rounded-xl border border-slate-200 p-5" key={preset.slot}><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-extrabold">지정 할인 {preset.slot}</h2><label className="flex min-h-10 items-center gap-2 text-sm font-bold"><input checked={preset.isActive} className="size-5 accent-blue-600" onChange={event => update(preset.slot, { isActive: event.target.checked })} type="checkbox" />사용</label></div><div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px_150px]"><label className="text-sm font-bold">할인 제목<input className="mt-2 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base" disabled={saving} maxLength={150} onChange={event => update(preset.slot, { title: event.target.value })} placeholder="예: SNS 리뷰" value={preset.title} /></label><label className="text-sm font-bold">할인 방식<select className="mt-2 min-h-12 w-full rounded-lg border border-slate-300 px-3 text-base" disabled={saving} onChange={event => update(preset.slot, { type: event.target.value as Preset["type"] })} value={preset.type}><option value="AMOUNT">금액 할인</option><option value="PERCENT">비율 할인</option></select></label><label className="text-sm font-bold">할인 값<div className="mt-2 flex min-h-12 items-center rounded-lg border border-slate-300 pr-3"><input className="min-w-0 flex-1 rounded-lg px-3 text-right text-base outline-none" disabled={saving} inputMode="numeric" onChange={event => update(preset.slot, { value: event.target.value.replace(/[^0-9]/g, "") })} placeholder="0" value={preset.value} /><span className="font-bold text-slate-500">{preset.type === "AMOUNT" ? "원" : "%"}</span></div></label></div></section>)}</div>{message && <p className={message.endsWith("저장했습니다.") ? "mt-5 font-semibold text-emerald-700" : "mt-5 font-semibold text-red-600"}>{message}</p>}<div className="mt-6 flex justify-end"><button className="min-h-12 rounded-xl bg-blue-600 px-7 text-lg font-extrabold text-white disabled:bg-slate-300" disabled={saving} onClick={() => void save()} type="button">{saving ? "저장 중..." : "저장"}</button></div></section>;
}
