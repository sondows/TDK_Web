"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { validateCustomerCreate, type CustomerCreateDraft, type CustomerFieldErrors, type CustomerSummary } from "@/lib/customer";
import PosSubHeader from "@/app/pos/PosSubHeader";
import StaffToggle from "@/app/admin/staff/StaffToggle";
import styles from "../admin.module.css";

export default function CustomerCreateModal({ customer, onClose, onSaved }: { customer: CustomerSummary | null; onClose: () => void; onSaved: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [draft, setDraft] = useState<CustomerCreateDraft>({
    name: customer?.name ?? "", contactName: customer?.contactName ?? "", phone: customer?.phone ?? "", email: customer?.email ?? "", memo: customer?.memo ?? "", isPaymentManaged: customer?.isPaymentManaged ?? false,
    autoCompletePayment: customer?.autoCompletePayment ?? true,
    autoPrintSignReceipt: customer?.autoPrintSignReceipt ?? true,
    usesFixedCoupon: customer?.usesFixedCoupon ?? false, fixedCouponAmount: customer?.fixedCouponAmount ? String(customer.fixedCouponAmount) : "",
    fixedCouponBalancePolicy: customer?.fixedCouponBalancePolicy ?? "FORFEIT",
    fixedCouponCashChangeEnabled: customer?.fixedCouponCashChangeEnabled ?? false,
    fixedCouponCashChangeMinPercent: customer?.fixedCouponCashChangeMinPercent === null ? "" : String(customer?.fixedCouponCashChangeMinPercent ?? ""),
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
        body: JSON.stringify({ ...draft, isActive }),
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
      <PosSubHeader backLabel={customer ? "고객관리로 돌아가기" : "고객 등록 닫기"} disabled={busy} onBack={onClose} title={customer ? "고객 수정" : "고객 등록"} titleId="customer-create-title" trailing={<StaffToggle checked={isActive} disabled={busy} label="사용" onChange={setIsActive} variant="customer" />} trailingClassName={styles.customerHeaderStatus} />
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
            <StaffToggle
              checked={draft.isPaymentManaged}
              disabled={busy}
              label={<span className="flex min-w-0 items-baseline gap-1"><strong className="shrink-0 font-bold">결제관리</strong><span className="text-xs font-normal text-slate-500">(선불금·미수금 관리 사용)</span></span>}
              onChange={checked => update("isPaymentManaged", checked)}
              variant="customer"
            />
          </div>
          <div className={`${styles.customerPaymentField} ${styles.customerCouponSetting}`}>
            <StaffToggle
              checked={draft.usesFixedCoupon}
              disabled={busy}
              label={<span className="flex min-w-0 items-baseline gap-1"><strong className="shrink-0 font-bold">정액쿠폰</strong><span className="text-[11px] font-normal text-slate-500">(금액지정·초과금액 반환여부·현금거스름 사용여부)</span></span>}
              onChange={checked => update("usesFixedCoupon", checked)}
              variant="customer"
            />
            {draft.usesFixedCoupon && <div className={styles.customerCouponOptions}>
              <div className={styles.customerCouponAmountRow}>
                <label htmlFor="customer-fixed-coupon-amount">쿠폰금액</label>
                <input aria-invalid={Boolean(errors.fixedCouponAmount)} className={`${styles.customerFieldInput} ${styles.customerCouponAmountInput}`} disabled={busy} id="customer-fixed-coupon-amount" inputMode="numeric" min="1" onChange={event => update("fixedCouponAmount", event.target.value.replace(/\D/g, ""))} type="number" value={draft.fixedCouponAmount} />
                {errors.fixedCouponAmount && <p className={styles.customerFieldError} role="alert">{errors.fixedCouponAmount}</p>}
              </div>
              <div aria-label="초과금액 처리" className={styles.customerCouponPolicyRow} role="group">
                <span>초과금액</span>
                <div>
                  <label><input checked={draft.fixedCouponBalancePolicy === "CASH_CHANGE"} disabled={busy} name="fixed-coupon-balance-policy" onChange={() => update("fixedCouponBalancePolicy", "CASH_CHANGE")} type="radio" />잔액 현금 반환</label>
                  <label><input checked={draft.fixedCouponBalancePolicy === "FORFEIT"} disabled={busy} name="fixed-coupon-balance-policy" onChange={() => update("fixedCouponBalancePolicy", "FORFEIT")} type="radio" />잔액 반환 없음 (기타소득처리)</label>
                </div>
                {errors.fixedCouponBalancePolicy && <p className={styles.customerFieldError} role="alert">{errors.fixedCouponBalancePolicy}</p>}
              </div>
              <div className={styles.customerCouponCashRow}>
                <label className={styles.customerPaymentLabel} htmlFor="customer-fixed-coupon-cash-change">
                  <input checked={draft.fixedCouponCashChangeEnabled} disabled={busy} id="customer-fixed-coupon-cash-change" onChange={event => update("fixedCouponCashChangeEnabled", event.target.checked)} type="checkbox" />현금거스름사용
                </label>
                <div className={styles.customerCouponThreshold}>
                  <input aria-label="현금 거스름 반환 기준 비율" aria-invalid={Boolean(errors.fixedCouponCashChangeMinPercent)} className={`${styles.customerFieldInput} ${styles.customerPercentInput}`} disabled={busy || !draft.fixedCouponCashChangeEnabled} id="customer-fixed-coupon-cash-change-percent" inputMode="numeric" min="0" max="100" onChange={event => update("fixedCouponCashChangeMinPercent", event.target.value.replace(/\D/g, ""))} type="number" value={draft.fixedCouponCashChangeMinPercent} />
                  <label htmlFor="customer-fixed-coupon-cash-change-percent">% 이상 사용 시 현금 거스름 반환</label>
                </div>
                {errors.fixedCouponCashChangeMinPercent && <p className={styles.customerFieldError} role="alert">{errors.fixedCouponCashChangeMinPercent}</p>}
              </div>
            </div>}
          </div>
          <div className={styles.customerPaymentField}>
            <StaffToggle
              checked={draft.autoCompletePayment}
              label={<span className="flex min-w-0 items-baseline gap-1 whitespace-nowrap"><strong className="font-bold">자동결제</strong><span className="font-normal text-slate-500">(설정된 시간이 지나면 자동 결제 완료)</span></span>}
              onChange={checked => update("autoCompletePayment", checked)}
              variant="customer"
            />
          </div>
          <div className={styles.customerPaymentField}>
            <StaffToggle
              checked={draft.autoPrintSignReceipt}
              label={<span className="flex min-w-0 items-baseline gap-1 whitespace-nowrap"><strong className="font-bold">사인영수증출력</strong><span className="font-normal text-slate-500">(증빙용 사인 영수증 출력)</span></span>}
              onChange={checked => update("autoPrintSignReceipt", checked)}
              variant="customer"
            />
          </div>
          {notice && <p className={styles.customerModalNotice} role="status">{notice}</p>}
        </div>
        <div className={styles.customerModalFooter}>
          {!customer && <button className={styles.customerCancelButton} disabled={busy} onClick={onClose} type="button">취소</button>}
          <button className={styles.customerSubmitButton} disabled={busy} type="submit">{busy ? "저장 중..." : customer ? "저장" : "등록"}</button>
        </div>
      </form>
    </dialog>
  );
}
