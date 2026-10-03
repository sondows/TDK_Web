"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateCustomerCreate, type CustomerCreateDraft, type CustomerFieldErrors, type CustomerSummary } from "@/lib/customer";
import styles from "../admin.module.css";

export default function CustomerCreateModal({ customer, onClose, onSaved }: { customer: CustomerSummary | null; onClose: () => void; onSaved: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [draft, setDraft] = useState<CustomerCreateDraft>({
    name: customer?.name ?? "", contactName: customer?.contactName ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", memo: customer?.memo ?? "", isPaymentManaged: customer?.isPaymentManaged ?? false,
  });
  const [isActive, setIsActive] = useState(customer?.isActive ?? true);
  const [errors, setErrors] = useState<CustomerFieldErrors>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    nameRef.current?.focus();
    return () => dialog?.close();
  }, []);

  const update = <K extends keyof CustomerCreateDraft>(key: K, value: CustomerCreateDraft[K]) => {
    setDraft(current => ({ ...current, [key]: value }));
    setErrors(current => ({ ...current, [key]: undefined }));
    setNotice("");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;
    const validated = validateCustomerCreate(draft);
    if (!validated.values) {
      setErrors(validated.errors);
      if (validated.errors.name) nameRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setErrors({});
    setNotice("");
    let saved = false;
    try {
      const response = await fetch(customer ? `/api/customers/${customer.customerId}` : "/api/customers", {
        method: customer ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customer ? { ...draft, isActive } : draft),
      });
      const result = await response.json() as { success?: boolean; errors?: CustomerFieldErrors; message?: string };
      if (!response.ok || !result.success) {
        if (response.status === 401) {
          setNotice("관리센터 로그인이 만료되었습니다. 다시 로그인해 주세요.");
          return;
        }
        if (response.status === 403) {
          setNotice("고객관리 권한이 없습니다.");
          return;
        }
        if (response.status === 400 && result.errors) setErrors(result.errors);
        setNotice(result.message ?? "고객을 저장하지 못했습니다.");
        return;
      }
      saved = true;
      onSaved();
    } catch {
      setNotice("고객을 저장하지 못했습니다.");
    } finally {
      busyRef.current = false;
      if (!saved) setBusy(false);
    }
  };

  return (
    <dialog
      aria-labelledby="customer-create-title"
      className={styles.customerModal}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
      ref={dialogRef}
    >
      <div className={styles.customerModalHeader}>
        <h2 id="customer-create-title">{customer ? "고객 수정" : "고객등록"}</h2>
        <button aria-label={customer ? "고객 수정 닫기" : "고객등록 닫기"} className={styles.customerModalClose} disabled={busy} onClick={onClose} type="button">×</button>
      </div>
      <form noValidate onSubmit={submit}>
        <div className={styles.customerModalFields}>
          <div className={styles.customerField}>
            <label htmlFor="customer-create-name">이름 <span aria-hidden="true">*</span></label>
            <input
              aria-describedby={errors.name ? "customer-create-name-error" : undefined}
              aria-invalid={Boolean(errors.name)}
              className={styles.customerFieldInput}
              disabled={busy}
              id="customer-create-name"
              maxLength={100}
              onChange={event => update("name", event.target.value)}
              ref={nameRef}
              required
              type="text"
              value={draft.name}
            />
            {errors.name && <p className={styles.customerFieldError} id="customer-create-name-error" role="alert">{errors.name}</p>}
          </div>
          <div className={styles.customerField}>
            <label htmlFor="customer-create-contact-name">담당</label>
            <input
              className={styles.customerFieldInput}
              disabled={busy}
              id="customer-create-contact-name"
              maxLength={100}
              onChange={event => update("contactName", event.target.value)}
              type="text"
              value={draft.contactName}
            />
            {errors.contactName && <p className={styles.customerFieldError} role="alert">{errors.contactName}</p>}
          </div>
          <div className={styles.customerField}>
            <label htmlFor="customer-create-phone">전화</label>
            <input
              className={styles.customerFieldInput}
              disabled={busy}
              id="customer-create-phone"
              maxLength={30}
              onChange={event => update("phone", event.target.value)}
              type="tel"
              value={draft.phone}
            />
            {errors.phone && <p className={styles.customerFieldError} role="alert">{errors.phone}</p>}
          </div>
          <div className={styles.customerField}>
            <label htmlFor="customer-create-email">이메일</label>
            <input
              aria-describedby={errors.email ? "customer-create-email-error" : undefined}
              aria-invalid={Boolean(errors.email)}
              className={styles.customerFieldInput}
              disabled={busy}
              id="customer-create-email"
              maxLength={255}
              onChange={event => update("email", event.target.value)}
              type="email"
              value={draft.email}
            />
            {errors.email && <p className={styles.customerFieldError} id="customer-create-email-error" role="alert">{errors.email}</p>}
          </div>
          <div className={styles.customerField}>
            <label htmlFor="customer-create-memo">메모</label>
            <textarea
              className={styles.customerFieldTextarea}
              disabled={busy}
              id="customer-create-memo"
              maxLength={2000}
              onChange={event => update("memo", event.target.value)}
              rows={5}
              value={draft.memo}
            />
            {errors.memo && <p className={styles.customerFieldError} role="alert">{errors.memo}</p>}
          </div>
          <div className={styles.customerPaymentField}>
            <label className={styles.customerPaymentLabel} htmlFor="customer-create-payment-managed">
              <input
                checked={draft.isPaymentManaged}
                disabled={busy}
                id="customer-create-payment-managed"
                onChange={event => update("isPaymentManaged", event.target.checked)}
                type="checkbox"
              />
              결제관리
            </label>
            <p>선불금·미수금 등 고객별 결제관리가 필요한 경우 사용</p>
          </div>
          {customer && <div className={styles.customerPaymentField}>
            <label className={styles.customerPaymentLabel} htmlFor="customer-edit-active">
              <input checked={isActive} disabled={busy} id="customer-edit-active" onChange={event => setIsActive(event.target.checked)} type="checkbox" />
              사용
            </label>
            <p>사용중지한 고객은 POS 고객 선택에서 제외됩니다.</p>
          </div>}
          {notice && <p className={styles.customerModalNotice} role="status">{notice}</p>}
        </div>
        <div className={styles.customerModalFooter}>
          <button className={styles.customerCancelButton} disabled={busy} onClick={onClose} type="button">취소</button>
          <button className={styles.customerSubmitButton} disabled={busy} type="submit">{busy ? "저장 중..." : customer ? "저장" : "등록"}</button>
        </div>
      </form>
    </dialog>
  );
}
