"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "../../../admin.module.css";

type Member = { staffId: number; name: string; loginId: string | null };
type Owner = Member & { status: "ACTIVE" | "SETUP_PENDING" | "RESET_REQUIRED" };
type DialogState =
  | { type: "actions" | "confirm-revoke" | "confirm-reset"; owner: Owner }
  | { type: "add" | "password" };

export default function OwnerManagement() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [employees, setEmployees] = useState<Member[]>([]);
  const [selected, setSelected] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin-center/security/owners", { cache: "no-store" });
      const result = await response.json() as { success?: boolean; owners?: Owner[]; employees?: Member[]; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "최고관리자 목록을 불러오지 못했습니다.");
      setOwners(result.owners ?? []); setEmployees(result.employees ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "최고관리자 목록을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin-center/security/owners", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as { success?: boolean; owners?: Owner[]; employees?: Member[]; message?: string };
        if (!response.ok || !result.success) throw new Error(result.message ?? "최고관리자 목록을 불러오지 못했습니다.");
        if (!controller.signal.aborted) { setOwners(result.owners ?? []); setEmployees(result.employees ?? []); }
      })
      .catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "최고관리자 목록을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const element = dialogRef.current;
    if (dialog && element && !element.open) element.showModal();
    if (!dialog && element?.open) element.close();
  }, [dialog]);

  const candidates = employees.filter(employee => !owners.some(owner => owner.staffId === employee.staffId));
  const closeDialog = () => { if (!busy) setDialog(null); };

  const act = async (action: "add" | "revoke" | "reset", staffId: number) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/security/owners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, staffId, ...(action === "reset" ? { password: resetPassword } : {}) }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "처리하지 못했습니다.");
      setMessage(action === "add" ? "최고관리자로 지정했습니다. 대상 직원은 본인이 보안 비밀번호를 설정해야 합니다." : action === "reset" ? "비밀번호 재설정 필요 상태로 변경했습니다." : "최고관리자 권한을 해제했습니다.");
      setSelected(""); setResetPassword(""); setDialog(null); await load(); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "처리하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !oldPassword || newPassword !== confirm || newPassword.length < 10) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/security/owner-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "change", oldPassword, newPassword }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "비밀번호를 변경하지 못했습니다.");
      setOldPassword(""); setNewPassword(""); setConfirm(""); setDialog(null);
      setMessage("보안 비밀번호를 변경했습니다. 다시 인증해 주세요."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "비밀번호를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const submitAdd = (event: FormEvent) => { event.preventDefault(); if (selected) void act("add", Number(selected)); };
  const submitDialogAction = () => {
    if (!dialog || !("owner" in dialog) || (dialog.type !== "confirm-revoke" && dialog.type !== "confirm-reset")) return;
    void act(dialog.type === "confirm-revoke" ? "revoke" : "reset", dialog.owner.staffId);
  };

  return <section className={styles.ownerManagement}>
    {message && !dialog && <p className={styles.ownerFeedback} role="status">{message}</p>}
    <section className={styles.ownerPanel} aria-labelledby="owner-list-title">
      <h2 id="owner-list-title">최고관리자 목록</h2>
      {loading ? <p className={styles.ownerEmpty}>불러오는 중입니다.</p> : owners.length === 0 ? <p className={styles.ownerEmpty}>등록된 최고관리자가 없습니다.</p> :
        <ul className={styles.ownerList}>
          {owners.map(owner => <li className={styles.ownerRow} key={owner.staffId}>
            <span className={styles.ownerLoginId}>{owner.loginId ?? "ID 없음"}</span>
            <span className={`${styles.ownerStatus} ${owner.status === "ACTIVE" ? styles.ownerStatusActive : styles.ownerStatusPending}`}>
              {owner.status === "ACTIVE" ? "설정 완료" : owner.status === "RESET_REQUIRED" ? "비밀번호 재설정 필요" : "최초 설정 대기"}
            </span>
            <button className={styles.ownerManageButton} disabled={busy} onClick={() => setDialog({ type: "actions", owner })} type="button">관리</button>
          </li>)}
        </ul>}
      <div className={styles.ownerAddArea}>
        <button className={styles.customerSubmitButton} disabled={busy || loading || candidates.length === 0} onClick={() => { setSelected(""); setDialog({ type: "add" }); }} type="button">+ 최고관리자 추가</button>
        {!loading && candidates.length === 0 && <span className={styles.ownerHint}>추가할 수 있는 직원이 없습니다.</span>}
      </div>
    </section>

    <section className={styles.ownerPasswordPanel} aria-label="내 보안 비밀번호">
      <strong>내 보안 비밀번호</strong>
      <button className={styles.ownerManageButton} disabled={busy} onClick={() => { setOldPassword(""); setNewPassword(""); setConfirm(""); setDialog({ type: "password" }); }} type="button">변경</button>
    </section>

    <dialog aria-labelledby="owner-dialog-title" className={`${styles.customerModal} ${styles.ownerDialog}`} onCancel={event => { event.preventDefault(); closeDialog(); }} onClose={() => setDialog(null)} ref={dialogRef}>
      {message && dialog && <p className={styles.ownerFeedback} role="alert">{message}</p>}
      {dialog?.type === "add" && <form onSubmit={submitAdd}>
        <div className={styles.customerModalHeader}><h2 id="owner-dialog-title">최고관리자 추가</h2><button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={closeDialog} type="button">×</button></div>
        <div className={styles.ownerDialogBody}>
          <label className={styles.customerField} htmlFor="new-owner-select">직원 선택
            <select className={styles.customerFieldInput} id="new-owner-select" onChange={event => setSelected(event.target.value)} value={selected}>
              <option value="">직원을 선택해 주세요</option>
              {candidates.map(employee => <option key={employee.staffId} value={employee.staffId}>{employee.name} ({employee.loginId})</option>)}
            </select>
          </label>
          <p className={styles.ownerHint}>추가된 직원은 다음 로그인 후 본인이 관리자 보안 비밀번호를 설정합니다.</p>
        </div>
        <div className={styles.customerModalFooter}><button className={styles.customerCancelButton} disabled={busy} onClick={closeDialog} type="button">취소</button><button className={styles.customerSubmitButton} disabled={busy || !selected} type="submit">{busy ? "추가 중…" : "추가"}</button></div>
      </form>}

      {dialog?.type === "actions" && <>
        <div className={styles.customerModalHeader}><h2 id="owner-dialog-title">최고관리자 관리</h2><button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={closeDialog} type="button">×</button></div>
        <div className={styles.ownerDialogBody}><strong>{dialog.owner.loginId ?? "ID 없음"}</strong><div className={styles.ownerActionChoices}>
          {dialog.owner.status === "ACTIVE" && <button className={styles.ownerActionButton} disabled={busy} onClick={() => { setResetPassword(""); setDialog({ type: "confirm-reset", owner: dialog.owner }); }} type="button">보안 비밀번호 초기화</button>}
          <button className={styles.ownerActionDanger} disabled={busy || owners.length <= 1} onClick={() => setDialog({ type: "confirm-revoke", owner: dialog.owner })} type="button">최고관리자 권한 해제</button>
          {owners.length <= 1 && <p className={styles.ownerHint}>마지막 최고관리자의 권한은 해제할 수 없습니다.</p>}
        </div></div>
        <div className={styles.customerModalFooter}><button className={styles.customerCancelButton} disabled={busy} onClick={closeDialog} type="button">닫기</button></div>
      </>}

      {(dialog?.type === "confirm-reset" || dialog?.type === "confirm-revoke") && <>
        <div className={styles.customerModalHeader}><h2 id="owner-dialog-title">{dialog.type === "confirm-reset" ? "보안 비밀번호 재설정" : "최고관리자 권한 해제"}</h2><button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={closeDialog} type="button">×</button></div>
        <div className={styles.ownerDialogBody}>
          <p>{dialog.type === "confirm-reset" ? "대상자의 보안 비밀번호와 기존 2차 인증 상태를 초기화합니다. 다음 ADM 로그인 후 본인이 새 비밀번호를 설정합니다." : "이 계정의 최고관리자 권한을 해제하시겠습니까?"}</p>
          {dialog.type === "confirm-reset" && <label className={styles.customerField}>내 관리자 보안 비밀번호<input className={styles.customerFieldInput} autoComplete="current-password" onChange={event => setResetPassword(event.target.value)} type="password" value={resetPassword} /></label>}
        </div>
        <div className={styles.customerModalFooter}><button className={styles.customerCancelButton} disabled={busy} onClick={() => { setResetPassword(""); setDialog({ type: "actions", owner: dialog.owner }); }} type="button">취소</button><button className={dialog.type === "confirm-revoke" ? styles.staffDeleteConfirmButton : styles.customerSubmitButton} disabled={busy || (dialog.type === "confirm-revoke" && owners.length <= 1) || (dialog.type === "confirm-reset" && !resetPassword)} onClick={submitDialogAction} type="button">{busy ? "처리 중…" : dialog.type === "confirm-reset" ? "초기화" : "권한 해제"}</button></div>
      </>}

      {dialog?.type === "password" && <form onSubmit={event => void changePassword(event)}>
        <div className={styles.customerModalHeader}><h2 id="owner-dialog-title">보안 비밀번호 변경</h2><button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={closeDialog} type="button">×</button></div>
        <div className={`${styles.ownerDialogBody} ${styles.ownerPasswordFields}`}>
          <label className={styles.customerField}>현재 비밀번호<input className={styles.customerFieldInput} autoComplete="current-password" onChange={event => setOldPassword(event.target.value)} type="password" value={oldPassword} /></label>
          <label className={styles.customerField}>새 비밀번호<input className={styles.customerFieldInput} autoComplete="new-password" maxLength={128} onChange={event => setNewPassword(event.target.value)} type="password" value={newPassword} /></label>
          <label className={styles.customerField}>새 비밀번호 확인<input className={styles.customerFieldInput} autoComplete="new-password" maxLength={128} onChange={event => setConfirm(event.target.value)} type="password" value={confirm} /></label>
          <p className={styles.ownerHint}>특수문자를 포함해 10자 이상 입력해 주세요. 12자 이상을 권장합니다.</p>
        </div>
        <div className={styles.customerModalFooter}><button className={styles.customerCancelButton} disabled={busy} onClick={closeDialog} type="button">취소</button><button className={styles.customerSubmitButton} disabled={busy || !oldPassword || newPassword.length < 10 || newPassword !== confirm} type="submit">{busy ? "변경 중…" : "변경"}</button></div>
      </form>}
    </dialog>
  </section>;
}
