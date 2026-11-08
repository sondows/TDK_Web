"use client";

import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import ProgramTrustGate, { ProgramAuthContext } from "@/components/ProgramTrustGate";
import PosTouchKeyboard from "@/components/PosTouchKeyboard";
import { OPENING_FUND_PROMPT_DISMISSED_KEY } from "@/lib/opening-fund-prompt";

export default function LoginPage() {
  return <ProgramTrustGate program="POS"><PosPinLogin /></ProgramTrustGate>;
}

function PosPinLogin() {
  const auth = useContext(ProgramAuthContext);
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [pinVisible, setPinVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const pinInput = useRef<HTMLInputElement>(null);
  const loginForm = useRef<HTMLFormElement>(null);
  const submitLock = useRef(false);

  useEffect(() => { pinInput.current?.focus(); }, []);
  useEffect(() => {
    if (!keyboardOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) ||
        (!target.closest("[data-pos-touch-keyboard]") && !target.closest("[data-pos-touch-input]")))
        setKeyboardOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [keyboardOpen]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth || submitLock.current || busy) return;
    if (pin.length !== 6) {
      setMessage("PIN 번호를 확인해 주세요.");
      pinInput.current?.focus();
      return;
    }
    submitLock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: auth.loginId.trim().toLowerCase(), pin }),
      });
      const result = await response.json() as { success?: boolean; message?: string; code?: string };
      if (!response.ok || !result.success) {
        if (result.code === "TRUST_REQUIRED") {
          setKeyboardOpen(false);
          setPinVisible(false);
          window.dispatchEvent(new Event("tdk-program-trust-required"));
          return;
        }
        setPin("");
        pinInput.current?.focus();
        setMessage(response.status === 429 ? result.message ?? "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요."
          : response.status === 401 ? "PIN 번호를 확인해 주세요."
            : result.message ?? "로그인을 완료하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      try { window.sessionStorage.removeItem(OPENING_FUND_PROMPT_DISMISSED_KEY); }
      catch { /* The authenticated POS session still checks the server. */ }
      setKeyboardOpen(false);
      setPinVisible(false);
      window.dispatchEvent(new Event("tdk-program-authenticated"));
      router.replace("/tdkpos");
    } catch {
      setPin("");
      pinInput.current?.focus();
      setMessage("로그인 요청 중 네트워크 오류가 발생했습니다.");
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  if (!auth) return null;
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-100 p-4">
    <section className="w-full max-w-[440px] rounded-2xl bg-white p-6 shadow-xl sm:p-8">
      <header className="mb-6 text-center">
        <h1 className="text-4xl font-extrabold text-blue-600">TDKON</h1>
        <p className="mt-2 text-lg font-bold text-slate-600">POS 로그인</p>
      </header>
      <form className="space-y-4" noValidate onSubmit={event => void submit(event)} ref={loginForm}>
        <label className="block text-sm font-bold text-slate-700">ID
          <input autoComplete="username" className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 bg-slate-100 px-4"
            readOnly value={auth.loginId} /></label>
        <div><label className="block text-sm font-bold text-slate-700" htmlFor="pos-pin-input">개인 6자리 PIN</label>
          <span className="relative mt-2 block" data-pos-touch-input="true">
            <input autoComplete="current-password" className="min-h-14 w-full rounded-xl border border-slate-300 px-4 pr-24"
              disabled={busy} id="pos-pin-input" inputMode="none" maxLength={6} onChange={event => {
                setPin(event.target.value.replace(/\D/g, "").slice(0, 6)); setMessage("");
              }} ref={pinInput} required type={pinVisible ? "text" : "password"} value={pin} />
            <span className="absolute inset-y-0 right-1 flex items-center">
              <button aria-label={pinVisible ? "Hide PIN" : "Show PIN"} aria-pressed={pinVisible}
                className="flex h-10 w-10 items-center justify-center text-slate-500 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                onPointerDown={event => event.preventDefault()} onClick={() => setPinVisible(value => !value)} type="button">
                {pinVisible ? <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7a11 11 0 01-3.2 4.4M6.2 6.2A11.4 11.4 0 002.5 12c1 2.5 4.5 7 9.5 7 1.1 0 2.1-.2 3-.5" />
                </svg> : <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                  <circle cx="12" cy="12" r="2.5" />
                </svg>}
              </button>
              <button aria-label="PIN keyboard open/close" aria-pressed={keyboardOpen}
                className="flex h-10 w-10 items-center justify-center text-slate-500 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                onPointerDown={event => event.preventDefault()} onClick={() => setKeyboardOpen(open => !open)} type="button">
                <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path strokeLinecap="round" d="M6 9h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M8 15h8" />
                </svg>
              </button>
            </span>
          </span>
        </div>
        <p aria-live="polite" className="min-h-6 text-center text-sm font-semibold text-red-600"
          role={message ? "alert" : undefined}>{message}</p>
        <button className="min-h-14 w-full rounded-xl bg-blue-600 font-extrabold text-white disabled:opacity-50"
          disabled={busy || pin.length !== 6 || keyboardOpen} type="submit">{busy ? "확인 중…" : "로그인"}</button>
        <p className="text-center text-xs text-slate-500">개인 6자리 PIN을 입력해 주세요.</p>
      </form>
    </section>
    {keyboardOpen && <PosTouchKeyboard mode="pin"
      onText={value => { setPin(current => (current + value).replace(/\D/g, "").slice(0, 6)); setMessage(""); }}
      onBackspace={() => { setPin(current => current.slice(0, -1)); setMessage(""); }}
      onClear={() => { setPin(""); setMessage(""); }}
      onConfirm={() => loginForm.current?.requestSubmit()}
      onClose={() => setKeyboardOpen(false)} actionLabel={busy ? "확인 중…" : "로그인"}
      actionDisabled={busy || pin.length !== 6} />}
  </main>;
}
