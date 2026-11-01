"use client";

import { useContext, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ProgramTrustGate, { ProgramAuthContext } from "@/components/ProgramTrustGate";
import styles from "../admin/admin.module.css";

function errorText(status: number, code?: string) {
  if (code === "EMPLOYEE_PIN_NOT_CONFIGURED") return "개인 PIN을 설정하지 않았습니다. 마스터 비밀번호 인증을 진행해 주세요.";
  if (code === "KDS_AUTH_SCHEMA_MISMATCH") return "인증 설정을 확인할 수 없습니다. 관리자에게 문의해 주세요.";
  if (code === "KDS_PERMISSION_DENIED") return "이 직원에게 KDS 사용 권한이 없습니다. 관리자에게 문의해 주세요.";
  if (code === "KDS_RATE_LIMIT_IP_UNAVAILABLE") return "KDS 네트워크 주소를 확인할 수 없습니다. 서버 또는 프록시 연결 설정을 확인해 주세요.";
  if (code === "KDS_NETWORK_RATE_LIMIT") return "이 네트워크에서 KDS 로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.";
  if (code === "KDS_PIN_RATE_LIMIT") return "KDS PIN 로그인 요청이 제한되었습니다. 잠시 후 다시 시도해 주세요.";
  if (code === "KDS_EMPLOYEE_RATE_LIMIT") return "PIN 인증 시도가 제한되었습니다. 잠시 후 ID와 PIN을 확인해 주세요.";
  if (code?.includes("RATE_LIMIT") || status === 429) return "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.";
  if (status === 401) return "ID 또는 PIN을 확인해 주세요.";
  if (status === 503) return "인증 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  return "로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export default function KitchenLogin() {
  return <ProgramTrustGate program="KDS"><KitchenPinLogin /></ProgramTrustGate>;
}

function KitchenPinLogin() {
  const router = useRouter();
  const auth = useContext(ProgramAuthContext);
  const loginId = auth?.loginId ?? "";
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pinInput = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);
  useEffect(() => { pinInput.current?.focus(); }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLoginId = loginId.trim().toLowerCase();
    if (busy || submitLock.current || !normalizedLoginId || !/^\d{6}$/.test(pin)) return;
    submitLock.current = true;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/kitchen/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: normalizedLoginId, pin }),
      });
      const result = await response.json() as { success?: boolean; code?: string };
      if (result.code === "TRUST_REQUIRED") {
        window.dispatchEvent(new Event("tdk-program-trust-required"));
        return;
      }
      if (!response.ok || !result.success) { setPin(""); setMessage(errorText(response.status, result.code)); return; }
      window.dispatchEvent(new Event("tdk-program-authenticated"));
      router.refresh();
    } catch { setPin(""); setMessage("네트워크 오류가 발생했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); submitLock.current = false; }
  };

  return <main className={styles.loginScreen}>
    <section className={styles.loginCard}>
      <div className={styles.loginHeading}><h1>TDKON</h1><p>KDS 로그인</p></div>
      {auth && <form className={styles.loginForm} onSubmit={event => void submit(event)}>
        <label htmlFor="kds-login-id">ID</label>
        <input autoComplete="username" id="kds-login-id" readOnly type="text" value={loginId} />
        <label htmlFor="kds-login-pin">PIN</label>
        <input autoComplete="current-password" autoFocus id="kds-login-pin" inputMode="numeric" maxLength={6}
          onChange={event => { setPin(event.target.value.replace(/\D/g, "").slice(0, 6)); setMessage(""); }}
          pattern="[0-9]{6}" ref={pinInput} required type="password" value={pin} />
        {message && <p className={styles.loginError} role="alert">{message}</p>}
        <button disabled={busy || !/^\d{6}$/.test(pin)} type="submit">
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </form>}
    </section>
  </main>;
}
