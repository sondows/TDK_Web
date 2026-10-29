"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function KitchenPinChange() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !/^\d{6}$/.test(pin) || pin !== confirm) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/kitchen/auth/change-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin, confirm }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) { setMessage(result.message ?? "PIN을 변경하지 못했습니다."); return; }
      router.refresh();
    } catch { setMessage("PIN을 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };
  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4"><form className="w-full max-w-[400px] space-y-4 rounded-2xl bg-white p-7 shadow-xl" onSubmit={event => void submit(event)}>
    <h1 className="text-2xl font-extrabold text-blue-700">직원 공통 PIN 설정</h1>
    <p className="text-sm text-slate-600">POS와 KDS에서 함께 사용할 개인 PIN을 설정해 주세요. 설정 후 기존 PIN은 사용할 수 없습니다.</p>
    <label className="block text-sm font-bold">새 6자리 PIN<input autoComplete="new-password" className="mt-2 min-h-14 w-full rounded-xl border px-4 text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={pin} /></label>
    <label className="block text-sm font-bold">새 PIN 확인<input autoComplete="new-password" className="mt-2 min-h-14 w-full rounded-xl border px-4 text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} onChange={event => setConfirm(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={confirm} /></label>
    {message && <p className="text-sm font-semibold text-red-600" role="alert">{message}</p>}
    <button className="min-h-12 w-full rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50" disabled={busy || !/^\d{6}$/.test(pin) || pin !== confirm} type="submit">{busy ? "저장 중…" : "PIN 저장"}</button>
  </form></main>;
}
