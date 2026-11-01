"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { OwnerSecurityState } from "@/lib/admin-auth";
import styles from "../../admin.module.css";

export default function OwnerSecurityPrompt({ state }: { state: OwnerSecurityState }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const denied = state === "NOT_OWNER";
  const setupRequired = state === "OWNER_UNCONFIGURED";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || denied || setupRequired || !password) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/security/owner-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", password }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) { setMessage(result.message ?? "인증을 완료하지 못했습니다."); setPassword(""); return; }
      setPassword(""); router.refresh();
    } catch { setMessage("인증 서비스를 이용할 수 없습니다."); }
    finally { setBusy(false); }
  };
  return <main className={styles.content}>
    <section className={styles.loginCard}>
      <div className={styles.loginHeading}><h1>보안 확인</h1><p>{denied ? "최고관리자만 이 메뉴를 이용할 수 있습니다." : setupRequired ? "직원별 마스터 비밀번호가 등록되지 않았습니다. ADM 로그인 화면에서 먼저 등록해 주세요." : "보안 메뉴에 진입하려면 마스터 비밀번호를 입력해 주세요."}</p></div>
      {!denied && !setupRequired && <form className={styles.loginForm} onSubmit={submit}>
        <label htmlFor="owner-security-password">마스터 비밀번호</label>
        <input autoComplete="current-password" id="owner-security-password" maxLength={128} onChange={event => setPassword(event.target.value)} required type="password" value={password} />
        {message && <p className={styles.loginError} role="alert">{message}</p>}
        <button disabled={busy || password.length === 0} type="submit">{busy ? "확인 중…" : "인증"}</button>
      </form>}
      {denied && <p role="status">최고관리자 지정 상태를 확인해 주세요.</p>}
    </section>
  </main>;
}
