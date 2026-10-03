"use client";

import { useEffect, useRef, useState } from "react";
import type { StaffSummary } from "@/lib/staff-management";
import styles from "../admin.module.css";

export default function StaffDeleteConfirm({ original, onClose, onSaved }: { original: StaffSummary; onClose: () => void; onSaved: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const deactivate = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin-center/staff/${original.staffId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: false }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) {
        setError(result.message ?? "직원을 사용중지하지 못했습니다.");
        return;
      }
      onSaved();
    } catch { setError("직원을 사용중지하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <dialog aria-describedby="staff-delete-description" aria-labelledby="staff-delete-title" className={`${styles.customerModal} ${styles.staffDeleteConfirm}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} ref={dialogRef}>
    <div className={styles.customerModalHeader}><h2 id="staff-delete-title">직원을 삭제하시겠습니까?</h2><button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={onClose} type="button">×</button></div>
    <div className={styles.staffDeleteConfirmText} id="staff-delete-description"><strong>{original.name}</strong><p>삭제된 직원은 로그인할 수 없으며 기존 주문 및 결제 기록은 유지됩니다.</p>{error && <p className={styles.customerFieldError} role="alert">{error}</p>}</div>
    <div className={styles.customerModalFooter}><button autoFocus className={styles.customerCancelButton} disabled={busy} onClick={onClose} type="button">취소</button><button className={styles.staffDeleteConfirmButton} disabled={busy} onClick={() => void deactivate()} type="button">{busy ? "처리 중..." : "삭제"}</button></div>
  </dialog>;
}
