"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { type StaffDraft, type StaffErrors, type StaffSummary, validateStaffDraft } from "@/lib/staff-management";
import StaffToggle from "./StaffToggle";
import StaffDeleteConfirm from "./StaffDeleteConfirm";
import styles from "../admin.module.css";

export default function StaffModal({ original, onClose, onSaved, hosPermissionAvailable = true }: { original: StaffSummary | null; onClose: () => void; onSaved: () => void; hosPermissionAvailable?: boolean }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [draft, setDraft] = useState<StaffDraft>({
    name: original?.name ?? "", loginId: original?.loginId ?? "", role: original?.role ?? "STAFF", isActive: original?.isActive ?? true,
    posEnabled: original?.posEnabled ?? true, kdsEnabled: original?.kdsEnabled ?? false, hosEnabled: original?.hosEnabled ?? false,
    employeePin: "", employeePinConfirm: "",
    adminEnabled: original?.adminEnabled ?? false,
  });
  const [changeEmployeePin, setChangeEmployeePin] = useState(!original?.hasEmployeePin);
  const [errors, setErrors] = useState<StaffErrors>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => { const dialog = dialogRef.current; dialog?.showModal(); nameRef.current?.focus(); return () => dialog?.close(); }, []);
  const update = <K extends keyof StaffDraft>(key: K, value: StaffDraft[K]) => { setDraft(current => ({ ...current, [key]: value })); setErrors({}); setNotice(""); };

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
      const result = await response.json() as { success?: boolean; message?: string; errors?: StaffErrors; reauthRequired?: boolean };
      if (!response.ok || !result.success) { if (result.errors) setErrors(result.errors); setNotice(result.message ?? "직원 정보를 저장하지 못했습니다."); return; }
      if (result.reauthRequired) { router.replace("/tdkadm/login"); return; }
      onSaved();
    } catch { setNotice("직원 정보를 저장하지 못했습니다."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const pinInput = (id: string, label: string, key: "employeePin" | "employeePinConfirm") => <div className={styles.customerField}>
    <label htmlFor={id}>{label}</label>
    <input aria-invalid={Boolean(errors[key])} autoComplete="new-password" className={styles.customerFieldInput} disabled={busy} id={id} inputMode="numeric" maxLength={6} onChange={event => update(key, event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" type="password" value={draft[key]} />
    {errors[key] && <p className={styles.customerFieldError} role="alert">{errors[key]}</p>}
  </div>;
  return <><dialog aria-labelledby="staff-modal-title" className={`${styles.customerModal} ${styles.staffModal}`} onCancel={event => { event.preventDefault(); if (!busy && !deleteOpen) onClose(); }} ref={dialogRef}>
    <div className={`${styles.customerModalHeader} ${styles.staffModalHeader}`}><h2 id="staff-modal-title">{original ? "직원 수정" : "직원 등록"}</h2><StaffToggle checked={draft.isActive} disabled={busy || original?.isDesignatedOwner} label="직원 활성" onChange={value => update("isActive", value)} /><button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={onClose} type="button">×</button></div>
    <form noValidate onSubmit={submit}><div className={styles.customerModalFields}>
      <section className={styles.staffFormSection}><h3>기본 정보</h3>
        <div className={styles.customerField}><label htmlFor="staff-name">이름 *</label><input aria-invalid={Boolean(errors.name)} className={styles.customerFieldInput} disabled={busy} id="staff-name" maxLength={100} onChange={event => update("name", event.target.value)} ref={nameRef} value={draft.name} />{errors.name && <p className={styles.customerFieldError} role="alert">{errors.name}</p>}</div>
        <div className={styles.customerField}><label htmlFor="staff-login-id">ID *</label><input aria-invalid={Boolean(errors.loginId)} autoCapitalize="none" autoComplete="off" autoCorrect="off" className={styles.customerFieldInput} disabled={busy} id="staff-login-id" maxLength={32} onChange={event => update("loginId", event.target.value.toLowerCase().replace(/\s/g, ""))} spellCheck={false} value={draft.loginId} />{errors.loginId && <p className={styles.customerFieldError} role="alert">{errors.loginId}</p>}<p className="text-xs text-slate-500">로그인에 사용하는 고유 ID입니다. 영문 소문자와 숫자 조합을 권장합니다.</p></div>
      </section>
      <section className={styles.staffFormSection}><h3>프로그램 접근 및 직원 PIN</h3>
        <StaffToggle checked={draft.posEnabled} disabled={busy} label="POS 사용 권한" onChange={value => update("posEnabled", value)} />
        <StaffToggle checked={draft.kdsEnabled} disabled={busy || !original} label="KDS 사용 권한" onChange={value => update("kdsEnabled", value)} />
        <StaffToggle checked={draft.hosEnabled} disabled={busy || !hosPermissionAvailable} label="HOS 사용 권한" onChange={value => update("hosEnabled", value)} />
        <StaffToggle checked={draft.adminEnabled} disabled={busy || original?.isDesignatedOwner} label="ADM 사용 권한" onChange={value => update("adminEnabled", value)} />
        {!original && <p className={styles.customerFieldError}>직원 등록 후 KDS 권한을 설정할 수 있습니다.</p>}
        {original?.hasEmployeePin && !changeEmployeePin ? <button className={styles.staffChangeButton} onClick={() => setChangeEmployeePin(true)} type="button">PIN 변경</button> : <>{pinInput("staff-employee-pin", original ? "새 PIN (6자리)" : "PIN (6자리) *", "employeePin")}{pinInput("staff-employee-pin-confirm", "PIN 확인", "employeePinConfirm")}</>}
        <p>직원별 6자리 PIN 하나를 POS·KDS·ADM에서 함께 사용합니다. PIN 원문은 저장 후 조회할 수 없습니다.</p>
      </section>
      {notice && <p className={styles.customerFieldError} role="alert">{notice}</p>}
    </div><div className={`${styles.customerModalFooter} ${styles.staffModalFooter}`}>
      {original && !original.isShared && !original.isDesignatedOwner && <button className={styles.staffDeleteButton} disabled={busy} onClick={() => setDeleteOpen(true)} type="button">삭제</button>}
      <div className={styles.staffModalFooterActions}><button className={styles.customerCancelButton} disabled={busy} onClick={onClose} type="button">취소</button><button className={styles.customerSubmitButton} disabled={busy} type="submit">{busy ? "저장 중…" : original ? "저장" : "직원 등록"}</button></div>
    </div></form>
  </dialog>
  {deleteOpen && original && !original.isShared && !original.isDesignatedOwner && <StaffDeleteConfirm original={original} onClose={() => setDeleteOpen(false)} onSaved={onSaved} />}
  </>;
}
