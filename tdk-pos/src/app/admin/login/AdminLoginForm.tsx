"use client";

import { useContext, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import ProgramTrustGate, { ProgramAuthContext } from "@/components/ProgramTrustGate";
import styles from "../admin.module.css";

export default function AdminLoginForm() {
  return <ProgramTrustGate program="ADM"><main className={styles.loginScreen}><AdminPinLogin /></main></ProgramTrustGate>;
}

function AdminPinLogin() {
  const router = useRouter();
  const auth = useContext(ProgramAuthContext);
  const loginId = auth?.loginId ?? "";
  const setLoginId = auth?.setLoginId ?? (() => {});
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !loginId.trim() || !/^\d{6}$/.test(pin)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: loginId.trim().toLowerCase(), pin }),
      });
      const result = await response.json() as { success?: boolean; code?: string; message?: string };
      if (result.code === "TRUST_REQUIRED") { window.dispatchEvent(new Event("tdk-program-trust-required")); return; }
      if (!response.ok || !result.success) {
        setMessage(response.status === 429 ? "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요."
          : result.code === "EMPLOYEE_PIN_NOT_CONFIGURED" ? result.message ?? "최초 인증 화면에서 본인이 PIN을 설정해 주세요."
            : response.status >= 500 ? "로그인 서비스를 이용할 수 없습니다." : "직원 또는 PIN을 확인해 주세요.");
        setPin("");
        return;
      }
      window.dispatchEvent(new Event("tdk-program-authenticated"));
      router.replace("/tdkadm"); router.refresh();
    } catch { setMessage("로그인에 실패했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };

  return <section className={styles.loginCard}>
    <div className={styles.loginHeading}><h1>TDKON</h1><p>로그인</p></div>
    <form className={styles.loginForm} onSubmit={submit}>
      <label htmlFor="admin-login-id">ID</label>
      <input autoCapitalize="none" autoComplete="username" autoCorrect="off" disabled={busy} readOnly
        id="admin-login-id" inputMode="text" lang="en" maxLength={32}
        onChange={event => { setLoginId(event.target.value); setMessage(""); }} spellCheck={false}
        type="text" value={loginId} />
      <label htmlFor="admin-login-pin">PIN</label>
      <input autoComplete="current-password" id="admin-login-pin" inputMode="numeric" maxLength={6}
        onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
        pattern="[0-9]{6}" required type="password" value={pin} />
      {message && <p className={styles.loginError} role="alert">{message}</p>}
      <button disabled={busy || !loginId.trim() || pin.length !== 6} type="submit">
        {busy ? "로그인 중..." : "로그인"}</button>
    </form>
  </section>;
}
