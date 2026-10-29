"use client";

import { useEffect, useState, type FormEvent } from "react";
import styles from "../../../../admin.module.css";

export default function DeviceRegistrationSettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { const controller = new AbortController(); void fetch("/api/admin-center/security/device-registration", { cache: "no-store", signal: controller.signal }).then(async response => { const result = await response.json() as { success?: boolean; enabled?: boolean }; if (!response.ok || !result.success) throw new Error(); setEnabled(result.enabled === true); }).catch(() => { if (!controller.signal.aborted) setMessage("기기 등록 설정을 불러오지 못했습니다."); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  const save = async (event: FormEvent) => { event.preventDefault(); if (busy || (enabled && (password.length < 8 || password !== confirm))) return; setBusy(true); setMessage(""); try { const response = await fetch("/api/admin-center/security/device-registration", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, password: enabled ? password : undefined, confirm: enabled ? confirm : undefined }) }); const result = await response.json() as { success?: boolean; message?: string }; if (!response.ok || !result.success) throw new Error(result.message ?? "설정을 저장하지 못했습니다."); setPassword(""); setConfirm(""); setMessage("설정을 저장했습니다."); } catch (error) { setMessage(error instanceof Error ? error.message : "설정을 저장하지 못했습니다."); } finally { setBusy(false); } };
  return <div className={styles.content}><div className={styles.pageHeading}><h1>보안 → 기기관리 → 등록 설정</h1><p className={styles.pageDescription}>기기 등록 요청에 OWNER가 별도 암호를 요구할지 설정합니다.</p></div>
    <section className={styles.customerSection}><form className={styles.customerModalFields} onSubmit={event => void save(event)}>
      {loading ? <p>설정을 불러오는 중입니다.</p> : <>
        <label className={styles.staffToggle}><input checked={enabled} onChange={event => setEnabled(event.target.checked)} type="checkbox" />기기등록 추가 암호 사용</label>
        {enabled && <><label className={styles.customerField}>기기 등록 암호 (8자 이상)<input className={styles.customerFieldInput} autoComplete="new-password" maxLength={128} onChange={event => setPassword(event.target.value)} type="password" value={password} /></label><label className={styles.customerField}>기기 등록 암호 확인<input className={styles.customerFieldInput} autoComplete="new-password" maxLength={128} onChange={event => setConfirm(event.target.value)} type="password" value={confirm} /></label><p>직원 PIN 및 관리자 보안 비밀번호와 별도이며, 기존 암호값은 다시 표시되지 않습니다.</p></>}
        {message && <p role="status">{message}</p>}<button className={styles.customerSubmitButton} disabled={busy || (enabled && (password.length < 8 || password !== confirm))} type="submit">{busy ? "저장 중…" : "설정 저장"}</button>
      </>}
    </form></section>
  </div>;
}
