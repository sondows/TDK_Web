"use client";

import { useCallback, useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ProgramTrustGate, { ProgramAuthContext } from "@/components/ProgramTrustGate";
import { decideHosSessionRestore } from "@/lib/hos-session-restore";

export default function HosLogin() {
  return <HosSessionGate />;
}

function HosSessionGate() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "login" | "error">("checking");
  const [message, setMessage] = useState("");
  const checkInFlight = useRef(false);

  const checkSession = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    try {
      const response = await fetch("/api/hos/auth/session", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json().catch(() => null) as { authenticated?: boolean; message?: string } | null;
      const decision = decideHosSessionRestore(response.status, result?.authenticated);
      if (decision === "LOGIN_REQUIRED") {
        setState("login");
        return;
      }
      if (decision === "RETRY") {
        setMessage(result?.message ?? "인증 상태를 확인할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
        setState("error");
        return;
      }
      router.refresh();
    } catch {
      setMessage("인증 서버에 연결할 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
      setState("error");
    } finally {
      checkInFlight.current = false;
    }
  }, [router]);

  useEffect(() => {
    const initialCheck = window.setTimeout(() => void checkSession(), 0);
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setState("checking");
        setMessage("");
        void checkSession();
      }
    };
    const onPageHide = () => {
      setState("checking");
      setMessage("");
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setState("checking");
        setMessage("");
        void checkSession();
      } else {
        setState("checking");
        setMessage("");
      }
    };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [checkSession]);

  if (state === "checking") return <main aria-live="polite" className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
    <section className="flex items-center gap-3 rounded-2xl bg-white px-6 py-5 text-sm font-semibold text-slate-600 shadow-lg">
      <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
      로그인 상태를 확인하고 있습니다.
    </section>
  </main>;

  if (state === "error") return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
    <section className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-lg">
      <p className="text-sm font-semibold text-slate-700" role="alert">{message}</p>
      <button className="mt-4 min-h-12 w-full rounded-xl bg-blue-600 font-bold text-white" onClick={() => { setState("checking"); setMessage(""); void checkSession(); }} type="button">다시 확인</button>
    </section>
  </main>;

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
