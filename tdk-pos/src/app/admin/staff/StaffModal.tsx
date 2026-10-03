"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { type StaffDraft, type StaffErrors, type StaffSummary, validateStaffDraft } from "@/lib/staff-management";
import StaffToggle from "./StaffToggle";
import StaffDeleteConfirm from "./StaffDeleteConfirm";
import styles from "../admin.module.css";

export default function StaffModal({ original, onClose, onSaved }: { original: StaffSummary | null; onClose: () => void; onSaved: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [draft, setDraft] = useState<StaffDraft>({
    name: original?.name ?? "", role: original?.role ?? "STAFF", isActive: original?.isActive ?? true,
    posEnabled: original?.posEnabled ?? true, posPin: "", posPinConfirm: "",
    adminEnabled: original?.adminEnabled ?? false, adminLoginId: original?.adminLoginId ?? "", adminPin: "", adminPinConfirm: "",
  });
  const [changePosPin, setChangePosPin] = useState(!original?.posEnabled);
  const [changeAdminPin, setChangeAdminPin] = useState(!original?.adminEnabled);
  const [errors, setErrors] = useState<StaffErrors>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    nameRef.current?.focus();
    return () => dialog?.close();
  }, []);

  const update = <K extends keyof StaffDraft>(key: K, value: StaffDraft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setErrors({}); setNotice("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;
    const found = validateStaffDraft(draft, original ?? undefined);
    if (Object.keys(found).length) { setErrors(found); if (found.name) nameRef.current?.focus(); return; }
    busyRef.current = true; setBusy(true); setErrors({}); setNotice("");
    try {
      const response = await fetch(original ? `/api/admin-center/staff/${original.staffId}` : "/api/admin-center/staff", {
        method: original ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const result = await response.json() as { success?: boolean; message?: string; errors?: StaffErrors };
      if (!response.ok || !result.success) {
        if (result.errors) setErrors(result.errors);
        setNotice(response.status === 401 ? "관리센터 로그인이 만료되었습니다. 다시 로그인해 주세요." : result.message ?? "직원 정보를 저장하지 못했습니다.");
        return;
      }
      onSaved();
    } catch { setNotice("직원 정보를 저장하지 못했습니다."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const input = (id: string, label: string, key: "posPin" | "posPinConfirm" | "adminPin" | "adminPinConfirm", maxLength: number) => (
    <div className={styles.customerField}>
      <label htmlFor={id}>{label}</label>
      <input aria-invalid={Boolean(errors[key])} autoComplete="new-password" className={styles.customerFieldInput} disabled={busy} id={id} inputMode="numeric" maxLength={maxLength} onChange={event => update(key, event.target.value)} pattern={maxLength === 4 ? "[0-9]{4}" : "[0-9]{6}"} type="password" value={draft[key]} />
      {errors[key] && <p className={styles.customerFieldError} role="alert">{errors[key]}</p>}
    </div>
  );

  return <><dialog aria-labelledby="staff-modal-title" className={`${styles.customerModal} ${styles.staffModal}`} onCancel={event => { event.preventDefault(); if (!busy && !deleteOpen) onClose(); }} ref={dialogRef}>
    <div className={styles.customerModalHeader}><h2 id="staff-modal-title">{original ? "직원 수정" : "직원 등록"}</h2><button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={onClose} type="button">×</button></div>
    <form noValidate onSubmit={submit}>
      <div className={styles.customerModalFields}>
        <section className={styles.staffFormSection}><h3>기본 정보</h3>
          <div className={styles.customerField}><label htmlFor="staff-name">이름 <span aria-hidden="true">*</span></label><input aria-invalid={Boolean(errors.name)} className={styles.customerFieldInput} disabled={busy} id="staff-name" maxLength={100} onChange={event => update("name", event.target.value)} ref={nameRef} value={draft.name} />{errors.name && <p className={styles.customerFieldError} role="alert">{errors.name}</p>}</div>
          <div className={styles.customerField}><label htmlFor="staff-role">권한 <span aria-hidden="true">*</span></label><select className={styles.customerFieldInput} disabled={busy} id="staff-role" onChange={event => { const role = event.target.value as StaffDraft["role"]; setDraft(current => ({ ...current, role, adminEnabled: role === "OWNER" && current.adminEnabled })); setErrors({}); }} value={draft.role}><option value="STAFF">STAFF</option><option value="MANAGER">MANAGER</option><option value="OWNER">OWNER</option></select></div>
          <StaffToggle checked={draft.isActive} disabled={busy} label="상태" onChange={value => update("isActive", value)} />
        </section>
        <section className={styles.staffFormSection}><h3>POS 로그인</h3>
          <StaffToggle checked={draft.posEnabled} disabled={busy} label="POS 사용" onChange={value => { update("posEnabled", value); if (value && !original?.posEnabled) setChangePosPin(true); }} />
          {draft.posEnabled && <>{original?.posEnabled && !changePosPin ? <button className={styles.staffChangeButton} onClick={() => setChangePosPin(true)} type="button">POS PIN 변경</button> : <>{input("staff-pos-pin", original ? "새 POS PIN" : "POS PIN *", "posPin", 4)}{input("staff-pos-confirm", "PIN 확인 *", "posPinConfirm", 4)}</>}</>}
        </section>
        <section className={styles.staffFormSection}><h3>관리센터 로그인</h3>
          <StaffToggle checked={draft.adminEnabled} disabled={busy || draft.role !== "OWNER"} label="관리센터 사용" onChange={value => { update("adminEnabled", value); if (value && !original?.adminEnabled) setChangeAdminPin(true); }} />
          {draft.role !== "OWNER" && <p className={styles.staffHint}>현재 관리센터 로그인은 OWNER만 사용할 수 있습니다.</p>}
          {errors.adminEnabled && <p className={styles.customerFieldError} role="alert">{errors.adminEnabled}</p>}
          {draft.adminEnabled && <><div className={styles.customerField}><label htmlFor="staff-admin-id">관리센터 아이디 *</label><input aria-invalid={Boolean(errors.adminLoginId)} autoCapitalize="none" autoComplete="off" className={styles.customerFieldInput} disabled={busy} id="staff-admin-id" maxLength={32} onChange={event => update("adminLoginId", event.target.value)} value={draft.adminLoginId} />{errors.adminLoginId && <p className={styles.customerFieldError} role="alert">{errors.adminLoginId}</p>}</div>
            {original?.adminEnabled && !changeAdminPin ? <button className={styles.staffChangeButton} onClick={() => setChangeAdminPin(true)} type="button">관리센터 PIN 변경</button> : <>{input("staff-admin-pin", original ? "새 관리센터 PIN" : "관리센터 PIN *", "adminPin", 6)}{input("staff-admin-confirm", "PIN 확인 *", "adminPinConfirm", 6)}</>}</>}
        </section>
        {notice && <p className={styles.customerFieldError} role="alert">{notice}</p>}
      </div>
      <div className={`${styles.customerModalFooter} ${styles.staffModalFooter}`}>
        {original && !original.isShared && <button className={styles.staffDeleteButton} disabled={busy} onClick={() => setDeleteOpen(true)} type="button">삭제</button>}
        <div className={styles.staffModalFooterActions}><button className={styles.customerCancelButton} disabled={busy} onClick={onClose} type="button">취소</button><button className={styles.customerSubmitButton} disabled={busy} type="submit">{busy ? "저장 중..." : original ? "저장" : "직원 등록"}</button></div>
      </div>
    </form>
  </dialog>
  {deleteOpen && original && !original.isShared && <StaffDeleteConfirm original={original} onClose={() => setDeleteOpen(false)} onSaved={onSaved} />}
  </>;
}
