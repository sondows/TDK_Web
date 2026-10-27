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
      const response = await fetch("/api/kitchen/auth/change-pin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, confirm }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) { setMessage(result.message ?? "Could not change the PIN."); return; }
      router.refresh();
    } catch { setMessage("Could not change the PIN."); }
    finally { setBusy(false); }
  };
  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4"><form className="w-full max-w-[400px] space-y-4 rounded-2xl bg-white p-7 shadow-xl" onSubmit={event => void submit(event)}>
    <h1 className="text-2xl font-extrabold text-blue-700">Change your KDS PIN</h1>
    <p className="text-sm text-slate-600">For security, change the temporary PIN before using KDS.</p>
    <label className="block text-sm font-bold">New 6-digit PIN<input autoComplete="new-password" className="mt-2 min-h-14 w-full rounded-xl border px-4 text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={pin} /></label>
    <label className="block text-sm font-bold">Confirm new PIN<input autoComplete="new-password" className="mt-2 min-h-14 w-full rounded-xl border px-4 text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} onChange={event => setConfirm(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={confirm} /></label>
    {message && <p className="text-sm font-semibold text-red-600" role="alert">{message}</p>}
    <button className="min-h-12 w-full rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50" disabled={busy || !/^\d{6}$/.test(pin) || pin !== confirm} type="submit">{busy ? "Saving…" : "Save PIN"}</button>
  </form></main>;
}
