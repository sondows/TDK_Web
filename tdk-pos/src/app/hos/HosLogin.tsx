"use client";

import { useContext, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ProgramTrustGate, { ProgramAuthContext } from "@/components/ProgramTrustGate";

export default function HosLogin() {
  return <ProgramTrustGate program="HOS"><HosPinLogin /></ProgramTrustGate>;
}

function HosPinLogin() {
  const auth = useContext(ProgramAuthContext);
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || busy || lock.current || !/^\d{6}$/.test(pin)) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/hos/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: auth.loginId.trim().toLowerCase(), pin }),
      });
      const result = await response.json() as { success?: boolean; code?: string; message?: string };
      if (result.code === "TRUST_REQUIRED") {
        window.dispatchEvent(new Event("tdk-program-trust-required"));
        return;
      }
      if (!response.ok || !result.success) {
        setPin("");
        setMessage(result.message ?? (response.status === 429
          ? "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요."
          : "ID 또는 PIN을 확인해 주세요."));
        return;
      }
      window.dispatchEvent(new Event("tdk-program-authenticated"));
      router.refresh();
    } catch {
      setPin("");
      setMessage("서버에 연결할 수 없습니다. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
    <section className="w-full max-w-md rounded-2xl bg-white p-7 shadow-xl">
      <header className="mb-7 text-center"><h1 className="text-4xl font-extrabold text-blue-600">TDKON</h1>
        <p className="mt-2 text-lg font-bold text-slate-700">TDK HOS</p></header>
      {auth && <form className="space-y-4" onSubmit={event => void submit(event)}>
        <label className="block text-sm font-bold text-slate-700">ID
          <input className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4" readOnly value={auth.loginId} /></label>
        <label className="block text-sm font-bold text-slate-700">개인 6자리 PIN
          <input autoFocus autoComplete="current-password" className="mt-2 min-h-16 w-full rounded-xl border border-slate-300 px-4 text-center text-2xl tracking-[0.5em]"
            inputMode="numeric" maxLength={6} onChange={event => { setPin(event.target.value.replace(/\D/g, "").slice(0, 6)); setMessage(""); }}
            required type="password" value={pin} /></label>
        {message && <p className="text-center text-sm font-semibold text-red-600" role="alert">{message}</p>}
        <button className="min-h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white disabled:opacity-50"
          disabled={busy || pin.length !== 6} type="submit">{busy ? "확인 중..." : "로그인"}</button>
        <p className="text-center text-xs text-slate-500">HOS 접근 권한이 있는 직원만 사용할 수 있습니다.</p>
      </form>}
    </section>
  </main>;
}
