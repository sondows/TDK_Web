"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { OwnerSecurityState } from "@/lib/admin-auth";
import styles from "../../admin.module.css";

export default function OwnerSecurityPrompt({ state }: { state: OwnerSecurityState }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const setup = state === "OWNER_UNCONFIGURED";
  const denied = state === "NOT_OWNER";
  const validOwnerPassword = password.length >= 10 && password.length <= 128 && /[^\p{L}\p{N}\s]/u.test(password);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || denied || (setup && password !== confirm)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/security/owner-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setup ? { action: "setup", password, confirm } : { action: "verify", password }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) { setMessage(result.message ?? "인증을 완료하지 못했습니다."); setPassword(""); setConfirm(""); return; }
      setPassword(""); setConfirm(""); router.refresh();
    } catch { setMessage("인증 서비스를 이용할 수 없습니다."); }
    finally { setBusy(false); }
  };
  return <main className={styles.content}>
    <section className={styles.loginCard}>
      <div className={styles.loginHeading}><h1>보안 확인</h1><p>{denied ? "최고관리자만 이 메뉴를 이용할 수 있습니다." : setup ? "본인의 관리자 보안 비밀번호를 최초 설정해 주세요. 12자 이상을 권장합니다." : "보안 메뉴에 진입하려면 관리자 보안 비밀번호를 입력해 주세요."}</p></div>
      {!denied && <form className={styles.loginForm} onSubmit={submit}>
        <label htmlFor="owner-security-password">{setup ? "새 관리자 보안 비밀번호 (특수문자 포함 10자 이상)" : "관리자 보안 비밀번호"}</label>
        <input autoComplete={setup ? "new-password" : "current-password"} id="owner-security-password" maxLength={128} onChange={event => setPassword(event.target.value)} required type="password" value={password} />
        {setup && <><label htmlFor="owner-security-confirm">비밀번호 확인</label><input autoComplete="new-password" id="owner-security-confirm" maxLength={128} onChange={event => setConfirm(event.target.value)} required type="password" value={confirm} /></>}
        {message && <p className={styles.loginError} role="alert">{message}</p>}
        <button disabled={busy || (setup ? !validOwnerPassword : password.length === 0) || (setup && password !== confirm)} type="submit">{busy ? "확인 중…" : setup ? "보안 비밀번호 설정" : "인증"}</button>
      </form>}
      {denied && <p role="status">최고관리자 지정 상태를 확인해 주세요.</p>}
    </section>
  </main>;
}
