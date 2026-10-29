"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "../admin.module.css";

export default function AdminLoginForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLoginId = loginId.trim().toLowerCase();
    if (busy || !normalizedLoginId || !/^\d{6}$/.test(pin)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: normalizedLoginId, pin }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { code?: string; message?: string } | null;
        setMessage(result?.code === "EMPLOYEE_PIN_NOT_CONFIGURED"
          ? result.message ?? "직원 공통 PIN이 설정되지 않았습니다. 관리자에게 PIN 설정을 요청해 주세요."
          : response.status === 429 ? "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." : "직원 또는 PIN을 확인해 주세요.");
        setPin(""); return;
      }
      router.replace("/tdkadm"); router.refresh();
    } catch { setMessage("로그인에 실패했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };

  return <section className={styles.loginCard}>
    <div className={styles.loginHeading}><h1>TDK 관리센터</h1><p>직원을 선택하고 공통 PIN을 입력해 주세요.</p></div>
    <form className={styles.loginForm} onSubmit={submit}>
      <label htmlFor="admin-login-id">ID</label>
      <input autoCapitalize="none" autoComplete="username" autoCorrect="off" disabled={busy} id="admin-login-id" inputMode="text" lang="en" maxLength={32} onChange={event => { setLoginId(event.target.value); setMessage(""); }} spellCheck={false} type="text" value={loginId} />
      <label htmlFor="admin-login-pin">PIN</label>
      <input autoComplete="current-password" id="admin-login-pin" inputMode="numeric" maxLength={6} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={pin} />
      {message && <p className={styles.loginError} role="alert">{message}</p>}
      <button disabled={busy || !loginId.trim() || pin.length !== 6} type="submit">{busy ? "로그인 중..." : "로그인"}</button>
    </form>
  </section>;
}
