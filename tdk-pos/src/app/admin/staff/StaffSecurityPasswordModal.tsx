"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../admin.module.css";

export default function StaffSecurityPasswordModal({ staff, onClose, onSaved }: {
  staff: { staffId: number; loginId: string | null }; onClose: () => void; onSaved?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { const current = dialog.current; current?.showModal(); return () => current?.close(); }, []);

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin-center/staff/${staff.staffId}/security-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) {
        setMessage(result.message ?? "직원 인증정보를 초기화하지 못했습니다.");
        return;
      }
      onSaved?.();
      onClose();
    } catch {
      setMessage("직원 인증정보를 초기화하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return <dialog aria-labelledby="staff-security-title" className={styles.customerModal}
    onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} ref={dialog}>
    <div className={styles.customerModalHeader}>
      <h2 id="staff-security-title">직원 인증정보 초기화</h2>
      <button aria-label="닫기" className={styles.customerModalClose} disabled={busy}
        onClick={onClose} type="button">×</button>
    </div>
    <div className={styles.customerModalFields}>
      <p>이 직원의 마스터 비밀번호와 개인 PIN을 초기화합니다.</p>
      <p>기존 POS, ADM, KDS, HOS에 발급된 모든 보안토큰과 로그인 세션도 무효화됩니다.</p>
      <p>직원은 다음 로그인 시 새로운 마스터 비밀번호와 PIN을 등록해야 합니다.</p>
      {message && <p className={styles.customerFieldError} role="alert">{message}</p>}
    </div>
    <div className={styles.customerModalFooter}>
      <button className={styles.customerCancelButton} disabled={busy} onClick={onClose} type="button">취소</button>
      <button className={styles.customerSubmitButton} disabled={busy} onClick={() => void reset()} type="button">
        {busy ? "초기화 중…" : "초기화"}
      </button>
    </div>
  </dialog>;
}
