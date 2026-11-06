"use client";

import { useState } from "react";
import { DEFAULT_KDS_ORDER_BUNDLE_SETTINGS, isKdsOrderBundleSettings, type KdsOrderBundleSettings } from "@/lib/kds-model";

export default function KdsOrderBundleForm({ initial }: { initial: KdsOrderBundleSettings }) {
  const [enabled, setEnabled] = useState((initial ?? DEFAULT_KDS_ORDER_BUNDLE_SETTINGS).enabled);
  const [minutes, setMinutes] = useState(String((initial ?? DEFAULT_KDS_ORDER_BUNDLE_SETTINGS).minutes));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    const numericMinutes = minutes.trim() === "" ? Number.NaN : Number(minutes);
    const settings = { enabled, minutes: numericMinutes };
    if (saving) return;
    if (!isKdsOrderBundleSettings(settings)) {
      setMessage("1~60분 정수를 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/kds-order-bundle", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
      });
      const result = await response.json() as { success?: boolean; message?: string; settings?: KdsOrderBundleSettings };
      if (!response.ok || !result.success || !isKdsOrderBundleSettings(result.settings)) {
        throw new Error(result.message ?? "설정을 저장하지 못했습니다.");
      }
      setEnabled(result.settings.enabled);
      setMinutes(String(result.settings.minutes));
      setMessage("주문 묶음 설정을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-slate-800">주문 묶음 시간</h2>
        <p className="mt-1 text-sm text-slate-600">같은 테이블에서 설정한 시간 내에 주문한 메뉴는 하나로 묶어 표시합니다.</p>
      </div>
      <button
        aria-checked={enabled}
        aria-label="주문 묶음 시간"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        onClick={() => { setEnabled(current => !current); setMessage(""); }}
        role="switch"
        type="button"
      >
        <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-in-out ${enabled ? "bg-[#2563EB]" : "bg-[#CBD5E1]"}`}>
          <span className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${enabled ? "translate-x-5" : "translate-x-0"}`} />
        </span>
        <span className={`w-8 text-center text-sm font-bold ${enabled ? "text-[#2563EB]" : "text-slate-500"}`}>{enabled ? "ON" : "OFF"}</span>
      </button>
    </div>
    <label className="mt-4 block text-sm font-semibold text-slate-700">묶음 시간 (분)
      <input aria-label="주문 묶음 시간 (분)" className="mt-1 h-10 w-full rounded border border-slate-300 px-3" inputMode="numeric" onChange={event => { setMinutes(event.target.value); setMessage(""); }} type="text" value={minutes} />
    </label>
    {message && <p aria-live="polite" className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    <button className="mt-4 min-h-10 rounded bg-slate-700 px-4 font-semibold text-white hover:bg-slate-800 disabled:opacity-50" disabled={saving} onClick={() => void save()} type="button">{saving ? "저장 중…" : "설정 저장"}</button>
  </section>;
}
