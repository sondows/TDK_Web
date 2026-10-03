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
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin-center/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, pin }),
      });
      if (!response.ok) {
        setMessage(response.status === 429 ? "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." : "아이디 또는 PIN을 확인해 주세요.");
        setPin("");
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setMessage("로그인에 실패했습니다. 다시 시도해 주세요.");
    } finally { setBusy(false); }
  };

  return <section className={styles.loginCard}>
    <div className={styles.loginHeading}><h1>TDK 관리센터</h1><p>관리센터 전용 계정으로 로그인해 주세요.</p></div>
    <form className={styles.loginForm} onSubmit={submit}>
      <label htmlFor="admin-login-id">아이디</label>
      <input autoComplete="username" autoFocus id="admin-login-id" maxLength={32} onChange={event => setLoginId(event.target.value)} required type="text" value={loginId} />
      <label htmlFor="admin-login-pin">PIN</label>
      <input autoComplete="current-password" id="admin-login-pin" inputMode="numeric" maxLength={6} onChange={event => setPin(event.target.value)} pattern="[0-9]{6}" required type="password" value={pin} />
      {message && <p className={styles.loginError} role="alert">{message}</p>}
      <button disabled={busy} type="submit">{busy ? "로그인 중..." : "로그인"}</button>
    </form>
  </section>;
}
