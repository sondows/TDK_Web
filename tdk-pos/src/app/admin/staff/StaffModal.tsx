"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { type StaffDraft, type StaffErrors, type StaffSummary, validateStaffDraft } from "@/lib/staff-management";
import StaffToggle from "./StaffToggle";
import StaffDeleteConfirm from "./StaffDeleteConfirm";
import StaffSecurityPasswordModal from "./StaffSecurityPasswordModal";
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
  const [errors, setErrors] = useState<StaffErrors>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [securityPasswordOpen, setSecurityPasswordOpen] = useState(false);
  const [createdPassword, setCreatedPassword] = useState("");

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
      const result = await response.json() as { success?: boolean; message?: string; errors?: StaffErrors;
        reauthRequired?: boolean; temporaryPassword?: string };
      if (!response.ok || !result.success) { if (result.errors) setErrors(result.errors); setNotice(result.message ?? "직원 정보를 저장하지 못했습니다."); return; }
      if (result.reauthRequired) { router.replace("/tdkadm/login"); return; }
      if (!original && result.temporaryPassword) { setCreatedPassword(result.temporaryPassword); return; }
      onSaved();
    } catch { setNotice("직원 정보를 저장하지 못했습니다."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return <><dialog aria-labelledby="staff-modal-title" className={`${styles.customerModal} ${styles.staffModal}`} onCancel={event => { event.preventDefault(); if (!busy && !deleteOpen) (createdPassword ? onSaved : onClose)(); }} ref={dialogRef}>
    <div className={`${styles.customerModalHeader} ${styles.staffModalHeader}`}><h2 id="staff-modal-title">{createdPassword ? "직원 등록 완료" : original ? "직원 수정" : "직원 등록"}</h2>{!createdPassword && <StaffToggle checked={draft.isActive} disabled={busy || original?.isDesignatedOwner || original?.isTerminated} label="직원 활성" onChange={value => update("isActive", value)} />}<button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={createdPassword ? onSaved : onClose} type="button">×</button></div>
    {createdPassword ? <div className={styles.customerModalFields}>
      <p>ID와 임시 마스터 비밀번호를 본인에게 안전하게 전달해 주세요. 임시 비밀번호는 이 화면에서 한 번만 표시됩니다.</p>
      <div className={styles.customerField}><label htmlFor="created-staff-id">ID</label>
        <input className={styles.customerFieldInput} id="created-staff-id" readOnly value={draft.loginId} /></div>
      <div className={styles.customerField}><label htmlFor="created-staff-password">임시 마스터 비밀번호</label>
        <input className={styles.customerFieldInput} id="created-staff-password" readOnly value={createdPassword} /></div>
      <button className={styles.customerSubmitButton} onClick={onSaved} type="button">확인</button>
    </div> : <form noValidate onSubmit={submit}><div className={styles.customerModalFields}>
      <section className={styles.staffFormSection}><h3>기본 정보</h3>
        <div className={styles.customerField}><label htmlFor="staff-name">이름 *</label><input aria-invalid={Boolean(errors.name)} className={styles.customerFieldInput} disabled={busy} id="staff-name" maxLength={100} onChange={event => update("name", event.target.value)} ref={nameRef} value={draft.name} />{errors.name && <p className={styles.customerFieldError} role="alert">{errors.name}</p>}</div>
        <div className={styles.customerField}><label htmlFor="staff-login-id">ID *</label><input aria-invalid={Boolean(errors.loginId)} autoCapitalize="none" autoComplete="off" autoCorrect="off" className={styles.customerFieldInput} disabled={busy} id="staff-login-id" maxLength={32} onChange={event => update("loginId", event.target.value.toLowerCase().replace(/\s/g, ""))} spellCheck={false} value={draft.loginId} />{errors.loginId && <p className={styles.customerFieldError} role="alert">{errors.loginId}</p>}<p className="text-xs text-slate-500">로그인에 사용하는 고유 ID입니다. 영문 소문자와 숫자 조합을 권장합니다.</p></div>
      </section>
      <section className={styles.staffFormSection}><h3>프로그램 접근</h3>
        <StaffToggle checked={draft.posEnabled} disabled={busy} label="POS 사용 권한" onChange={value => update("posEnabled", value)} />
        <StaffToggle checked={draft.kdsEnabled} disabled={busy} label="KDS 사용 권한" onChange={value => update("kdsEnabled", value)} />
        <StaffToggle checked={draft.hosEnabled} disabled={busy || !hosPermissionAvailable} label="HOS 사용 권한" onChange={value => update("hosEnabled", value)} />
        <StaffToggle checked={draft.adminEnabled} disabled={busy || original?.isDesignatedOwner} label="ADM 사용 권한" onChange={value => update("adminEnabled", value)} />
        <p>직원 본인이 최초 인증 후 개인 PIN을 설정합니다. 기존 PIN은 그대로 유지됩니다.</p>
        {original && !original.isTerminated && <button className={styles.staffChangeButton} onClick={() => setSecurityPasswordOpen(true)}
            type="button">마스터 비밀번호 · PIN 초기화</button>}
      </section>
      {notice && <p className={styles.customerFieldError} role="alert">{notice}</p>}
    </div><div className={`${styles.customerModalFooter} ${styles.staffModalFooter}`}>
      {original && !original.isShared && !original.isDesignatedOwner && !original.isTerminated && <button className={styles.staffDeleteButton} disabled={busy} onClick={() => setDeleteOpen(true)} type="button">퇴사 처리</button>}
      <div className={styles.staffModalFooterActions}><button className={styles.customerCancelButton} disabled={busy} onClick={onClose} type="button">취소</button><button className={styles.customerSubmitButton} disabled={busy} type="submit">{busy ? "저장 중…" : original ? "저장" : "직원 등록"}</button></div>
    </div></form>}
  </dialog>
  {deleteOpen && original && !original.isShared && !original.isDesignatedOwner && !original.isTerminated && <StaffDeleteConfirm original={original} onClose={() => setDeleteOpen(false)} onSaved={onSaved} />}
  {securityPasswordOpen && original && <StaffSecurityPasswordModal staff={original}
    onClose={() => setSecurityPasswordOpen(false)} onSaved={onSaved} />}
  </>;
}
