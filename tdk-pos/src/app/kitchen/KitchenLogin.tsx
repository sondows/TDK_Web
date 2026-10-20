"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function KitchenLogin() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !/^\d{6}$/.test(pin)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/kitchen/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, pin }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "로그인에 실패했습니다.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-5">
    <form className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6" onSubmit={event => void login(event)}>
      <h1 className="text-2xl font-extrabold text-slate-900">TDK KDS</h1>
      <label className="mt-6 block text-sm font-bold text-slate-700">ID
        <input autoCapitalize="none" autoComplete="username" className="mt-2 min-h-14 w-full rounded-lg border border-slate-300 px-3 text-lg" onChange={event => setLoginId(event.target.value)} required value={loginId} />
      </label>
      <label className="mt-4 block text-sm font-bold text-slate-700">6자리 번호
        <input autoComplete="current-password" className="mt-2 min-h-14 w-full rounded-lg border border-slate-300 px-3 text-lg" inputMode="numeric" maxLength={6} minLength={6} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={pin} />
      </label>
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      <button className="mt-6 min-h-14 w-full rounded-xl bg-slate-800 font-bold text-white disabled:opacity-50" disabled={busy || !/^\d{6}$/.test(pin)} type="submit">{busy ? "로그인 중..." : "로그인"}</button>
    </form>
  </main>;
}
