"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CustomerSummary } from "@/lib/customer";
import { adjustmentReasons, formatTradeBalance, tradeMethods } from "@/lib/customer-trade";
import styles from "../admin.module.css";

export type TradeAction = "DEPOSIT" | "REFUND" | "ADJUSTMENT";

function nowInKorea() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function newRequestKey() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export default function CustomerTradeEntryModal({ action, balance, customer, onClose, onSaved }: {
  action: TradeAction;
  balance: number;
  customer: CustomerSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestKey = useRef(newRequestKey());
  const lastPayload = useRef<string | null>(null);
  const [amount, setAmount] = useState("");
  const [methodCode, setMethodCode] = useState<string>("CASH");
  const [transactionAt, setTransactionAt] = useState(nowInKorea);
  const [memo, setMemo] = useState("");
  const [reason, setReason] = useState<string>("");
  const [customReason, setCustomReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const title = action === "DEPOSIT" ? "입금 처리" : action === "REFUND" ? "환불 처리" : "잔액조정";
  const numericAmount = Number(amount);
  const adjustment = action === "ADJUSTMENT" && amount !== "" && Number.isSafeInteger(numericAmount) ? numericAmount - balance : null;
  const name = customer.name.trim() || customer.phone || "—";

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current) return;
    if (amount.trim() === "" || !Number.isSafeInteger(numericAmount)
      || Math.abs(numericAmount) > 999999999999 || (action !== "ADJUSTMENT" && numericAmount <= 0)) {
      setError("금액을 확인해 주세요.");
      return;
    }
    if (action === "REFUND" && (balance <= 0 || numericAmount > balance)) {
      setError("현재 플러스 거래잔액을 초과하여 환불할 수 없습니다.");
      return;
    }
    if (action === "ADJUSTMENT" && (!reason || reason === "기타" && !customReason.trim())) {
      setError("조정사유를 입력해 주세요.");
      return;
    }
    if (action === "ADJUSTMENT" && adjustment === 0) {
      setError("조정할 금액이 없습니다.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const payload = JSON.stringify({
        kind: action,
        amount: action === "ADJUSTMENT" ? undefined : numericAmount,
        targetBalance: action === "ADJUSTMENT" ? numericAmount : undefined,
        methodCode: action === "ADJUSTMENT" ? undefined : methodCode,
        transactionAt, memo, reason, customReason,
      });
      if (lastPayload.current !== null && lastPayload.current !== payload) requestKey.current = newRequestKey();
      lastPayload.current = payload;
      const response = await fetch(`/api/customers/${customer.customerId}/ledger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...JSON.parse(payload) as Record<string, unknown>, requestKey: requestKey.current }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) {
        setError(result.message ?? "거래를 기록하지 못했습니다.");
        return;
      }
      onSaved();
    } catch {
      setError("거래를 기록하지 못했습니다.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog aria-labelledby="customer-trade-entry-title" className={styles.customerTradeEntryModal}
      onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} ref={dialogRef}>
      <div className={styles.customerModalHeader}>
        <h2 id="customer-trade-entry-title">{title}</h2>
        <button aria-label="닫기" className={styles.customerModalClose} disabled={busy} onClick={onClose} type="button">×</button>
      </div>
      <form onSubmit={submit}>
        <div className={styles.customerModalFields}>
          <div className={styles.customerTradeEntryInfo}><span>고객명</span><strong>{name}</strong></div>
          <div className={styles.customerTradeEntryInfo}><span>현재 거래잔액</span><strong>{formatTradeBalance(balance)}</strong></div>
          <div className={styles.customerField}>
            <label htmlFor="customer-trade-amount">{action === "ADJUSTMENT" ? "조정 후 잔액" : action === "DEPOSIT" ? "입금금액" : "환불금액"}</label>
            <input autoFocus className={styles.customerFieldInput} id="customer-trade-amount" inputMode="numeric"
              max={999999999999} min={action === "ADJUSTMENT" ? -999999999999 : 1} onChange={event => setAmount(event.target.value)}
              required step="1" type="number" value={amount} />
          </div>
          {action === "ADJUSTMENT" ? <>
            <div className={styles.customerTradeEntryInfo}><span>조정금액</span><strong>{adjustment === null ? "—" : formatTradeBalance(adjustment)}</strong></div>
            <div className={styles.customerField}>
              <label htmlFor="customer-trade-reason">조정사유</label>
              <select className={styles.customerFieldInput} id="customer-trade-reason" onChange={event => setReason(event.target.value)} value={reason}>
                <option value="">선택해 주세요</option>
                {adjustmentReasons.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            {reason === "기타" && <div className={styles.customerField}>
              <label htmlFor="customer-trade-custom-reason">기타 사유</label>
              <input className={styles.customerFieldInput} id="customer-trade-custom-reason" maxLength={100} onChange={event => setCustomReason(event.target.value)} value={customReason} />
            </div>}
          </> : <fieldset className={styles.customerTradeMethods}>
            <legend>{action === "DEPOSIT" ? "입금방법" : "환불방법"}</legend>
            <div>{tradeMethods.map(method => <label key={method.value}>
              <input checked={methodCode === method.value} onChange={() => setMethodCode(method.value)} type="radio" value={method.value} />
              {method.label}
            </label>)}</div>
          </fieldset>}
          <div className={styles.customerField}>
            <label htmlFor="customer-trade-at">{action === "ADJUSTMENT" ? "조정일시" : action === "DEPOSIT" ? "입금일시" : "환불일시"}</label>
            <input className={styles.customerFieldInput} id="customer-trade-at" onChange={event => setTransactionAt(event.target.value)}
              required type="datetime-local" value={transactionAt} />
          </div>
          {action !== "ADJUSTMENT" && <div className={styles.customerField}>
            <label htmlFor="customer-trade-memo">메모</label>
            <textarea className={styles.customerFieldTextarea} id="customer-trade-memo" maxLength={500}
              onChange={event => setMemo(event.target.value)} rows={3} value={memo} />
          </div>}
          {error && <p className={styles.customerFieldError} role="alert">{error}</p>}
        </div>
        <div className={styles.customerModalFooter}>
          <button className={styles.customerCancelButton} disabled={busy} onClick={onClose} type="button">취소</button>
          <button className={styles.customerSubmitButton} disabled={busy} type="submit">{busy ? "처리 중..." : action === "ADJUSTMENT" ? "조정처리" : action === "DEPOSIT" ? "입금처리" : "환불처리"}</button>
        </div>
      </form>
    </dialog>
  );
}
