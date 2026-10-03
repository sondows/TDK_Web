"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { StaffSummary } from "@/lib/staff-management";
import styles from "../admin.module.css";

export default function SharedPosPinModal({ original, onClose, onSaved }: { original: StaffSummary; onClose: () => void; onSaved: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const [posPin, setPosPin] = useState("");
  const [posPinConfirm, setPosPinConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    pinRef.current?.focus();
    return () => dialog?.close();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!/^\d{4}$/.test(posPin) || posPin !== posPinConfirm) {
      setError("POS PIN은 일치하는 숫자 4자리여야 합니다.");
      pinRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin-center/staff/${original.staffId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ posPin, posPinConfirm }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) { setError(result.message ?? "POS PIN을 저장하지 못했습니다."); return; }
      onSaved();
    } catch { setError("POS PIN을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <dialog aria-labelledby="shared-pin-title" className={styles.customerModal} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} ref={dialogRef}>
    <div className={styles.customerModalHeader}><h2 id="shared-pin-title">매장 공용 POS PIN {original.posEnabled ? "변경" : "설정"}</h2><button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={onClose} type="button">×</button></div>
    <form noValidate onSubmit={submit}>
      <div className={styles.customerModalFields}>
        <p className={styles.customerModalNotice}>매장 공용 계정은 POS 로그인용 PIN만 설정할 수 있습니다.</p>
        <div className={styles.customerField}><label htmlFor="shared-pos-pin">새 POS PIN</label><input autoComplete="new-password" className={styles.customerFieldInput} disabled={busy} id="shared-pos-pin" inputMode="numeric" maxLength={4} onChange={event => { setPosPin(event.target.value); setError(""); }} pattern="[0-9]{4}" ref={pinRef} type="password" value={posPin} /></div>
        <div className={styles.customerField}><label htmlFor="shared-pos-pin-confirm">PIN 확인</label><input autoComplete="new-password" className={styles.customerFieldInput} disabled={busy} id="shared-pos-pin-confirm" inputMode="numeric" maxLength={4} onChange={event => { setPosPinConfirm(event.target.value); setError(""); }} pattern="[0-9]{4}" type="password" value={posPinConfirm} /></div>
        {error && <p className={styles.customerFieldError} role="alert">{error}</p>}
      </div>
      <div className={styles.customerModalFooter}><button className={styles.customerCancelButton} disabled={busy} onClick={onClose} type="button">취소</button><button className={styles.customerSubmitButton} disabled={busy} type="submit">{busy ? "저장 중..." : "저장"}</button></div>
    </form>
  </dialog>;
}
