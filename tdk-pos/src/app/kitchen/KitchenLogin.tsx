"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function KitchenLogin() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !employeeId.trim() || !/^\d{6}$/.test(pin)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/kitchen/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employeeId.trim(), pin }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      setPin("");
      if (!response.ok || !result.success) {
        setMessage(result.message ?? "Employee ID or KDS PIN is incorrect.");
        return;
      }
      router.refresh();
    } catch {
      setPin("");
      setMessage("Could not sign in. Check the network and try again.");
    } finally { setBusy(false); }
  };

  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
    <section className="w-full max-w-[380px] rounded-2xl bg-white p-8 shadow-xl">
      <header className="mb-7 text-center">
        <h1 className="text-4xl font-extrabold text-blue-600">TDK KDS</h1>
        <p className="mt-2 text-lg font-bold text-slate-600">Employee sign in</p>
      </header>
      <form className="space-y-5" onSubmit={event => void login(event)}>
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700" htmlFor="kds-employee-id">Employee ID</label>
          <input autoComplete="username" autoCapitalize="none" className="min-h-14 w-full rounded-xl border border-slate-300 px-4 text-lg font-semibold outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" id="kds-employee-id" maxLength={30} onChange={event => setEmployeeId(event.target.value)} required value={employeeId} />
        </div>
        <div>
          <label className="mb-2 block text-sm font-bold text-slate-700" htmlFor="kds-pin">6-digit KDS PIN</label>
          <input autoComplete="current-password" className="min-h-14 w-full rounded-xl border border-slate-300 px-4 text-center text-2xl font-bold tracking-[0.5em] outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" id="kds-pin" inputMode="numeric" maxLength={6} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={pin} />
        </div>
        {message && <p className="text-center text-sm font-semibold text-red-600" role="alert">{message}</p>}
        <button className="min-h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white disabled:cursor-wait disabled:opacity-50" disabled={busy || !employeeId.trim() || !/^\d{6}$/.test(pin)} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </section>
  </main>;
}
