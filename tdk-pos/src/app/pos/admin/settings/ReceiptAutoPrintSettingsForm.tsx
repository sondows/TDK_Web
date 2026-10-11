"use client";

import { useState } from "react";

export default function ReceiptAutoPrintSettingsForm({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const change = async () => {
    if (saving) return;
    const next = !enabled;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/pos-settings/receipt-auto-print", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "설정 저장에 실패했습니다.");
      setEnabled(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "설정 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="mx-auto mt-6 max-w-xl rounded-2xl bg-white p-6 shadow-sm">
    <h2 className="text-xl font-bold">영수증 출력</h2>
    <button aria-checked={enabled} aria-label="결제 후 영수증 항상 인쇄" className="mt-5 flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 text-left font-semibold text-slate-800 disabled:opacity-50" disabled={saving} onClick={() => void change()} role="switch" type="button">
      <span>결제 후 영수증 항상 인쇄</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-bold text-slate-600">{enabled ? "ON" : "OFF"}</span>
        <span aria-hidden="true" className={`flex h-7 w-14 items-center rounded-full p-1 transition-colors ${enabled ? "bg-blue-600" : "bg-slate-300"}`}>
          <span className={`size-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-7" : "translate-x-0"}`} />
        </span>
      </span>
    </button>
    {message && <p className="mt-3 text-sm text-red-600" role="alert">{message}</p>}
  </section>;
}
