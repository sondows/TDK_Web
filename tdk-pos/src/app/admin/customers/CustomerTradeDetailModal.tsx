"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomerTradeDetail, CustomerTradeDetailResponse } from "@/lib/customer-trade";
import { formatTradeBalance, tradeMethods, tradeTypeLabel } from "@/lib/customer-trade";
import AdminBackLink from "@/app/pos/admin/AdminBackLink";
import styles from "../admin.module.css";

const money = (amount: number) => amount.toLocaleString("ko-KR");
const tradeTime = (value: string) => value.replace("T", " ").slice(0, 16);
const paymentStatus = (status: string) => ({
  APPROVED: "결제완료", CANCELLED: "결제취소", REFUNDED: "환불", PENDING: "진행 중", FAILED: "실패",
} as Record<string, string>)[status] ?? status;

export default function CustomerTradeDetailModal({ customerId, ledgerId, onClose }: {
  customerId: number;
  ledgerId: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<CustomerTradeDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/customers/${customerId}/ledger/${ledgerId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as CustomerTradeDetailResponse;
        if (!response.ok || !result.success || !result.detail) throw new Error(result.message ?? "거래 상세를 불러오지 못했습니다.");
        return result.detail;
      })
      .then(result => { if (!controller.signal.aborted) setDetail(result); })
      .catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "거래 상세를 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [customerId, ledgerId]);

  const entry = detail?.entry;
  const method = entry?.methodCode ? tradeMethods.find(item => item.value === entry.methodCode)?.label ?? entry.methodCode : null;

  return <dialog aria-labelledby="customer-trade-detail-title" className={styles.customerTradeDetailModal}
    onCancel={event => { event.preventDefault(); onClose(); }} ref={dialogRef}>
    <div className={styles.customerTradeHeader}>
      <AdminBackLink ariaLabel="거래관리로 돌아가기" iconSize={28} onNavigate={onClose} size={44} title="거래관리로 돌아가기" tone="lightPlain" />
      <h2 id="customer-trade-detail-title">거래 상세</h2>
    </div>
    {error ? <p className={styles.customerTradeError} role="alert">{error}</p>
      : !detail || !entry ? <p className={styles.customerTradeDetailLoading}>거래 상세를 불러오는 중입니다.</p>
        : <div className={styles.customerTradeDetailBody}>
          <time className={styles.customerTradeDetailTime} dateTime={entry.transactionAt}>{tradeTime(entry.transactionAt)}</time>
          <dl className={styles.customerTradeDetailFacts}>
            <div><dt>거래유형</dt><dd>{tradeTypeLabel(entry.entryType)}</dd></div>
            <div><dt>고객명</dt><dd>{detail.customerName}</dd></div>
            {detail.checkout?.place && <div><dt>테이블 / 포장</dt><dd>{detail.checkout.place}</dd></div>}
            {entry.paymentId !== null && <div><dt>결제번호</dt><dd>#{entry.paymentId}</dd></div>}
            <div><dt>거래번호</dt><dd>#{entry.ledgerId}</dd></div>
            {(detail.payment?.methodName || method) && <div><dt>처리방법</dt><dd>{detail.payment?.methodName ?? method}</dd></div>}
            {detail.payment && <div><dt>결제상태</dt><dd>{paymentStatus(detail.payment.status)}</dd></div>}
            {entry.adjustmentReason && <div><dt>조정사유</dt><dd>{entry.adjustmentReason}</dd></div>}
            {entry.memo && <div><dt>메모</dt><dd>{entry.memo}</dd></div>}
          </dl>

          {entry.reversesLedgerId !== null && <section className={styles.customerTradeDetailSection}>
            <h3>취소 관계</h3>
            <dl className={styles.customerTradeDetailFacts}>
              {detail.original && <div><dt>원거래</dt><dd>#{detail.original.ledgerId}</dd></div>}
              {detail.original?.paymentId && <div><dt>원결제</dt><dd>#{detail.original.paymentId}</dd></div>}
              <div><dt>취소금액</dt><dd>{money(Math.abs(entry.amount))}</dd></div>
            </dl>
          </section>}

          <section className={styles.customerTradeDetailSection}>
            <h3>주문내역</h3>
            {detail.checkout?.items.length ? <div className={styles.customerTradeDetailItems}>
              {detail.checkout.items.map(item => <div className={styles.customerTradeDetailItem} key={item.checkoutItemId}>
                <div className={styles.customerTradeDetailItemName}><strong>{item.name}</strong>
                  <small>당시 단가 {money(item.unitPrice)}</small>
                  {!!item.options.length && <small>{item.options.join(" · ")}</small>}
                  {item.note && <small>{item.note}</small>}
                </div>
                <span className={styles.customerTradeDetailItemQty} aria-label={`수량 ${item.qty}`}>{item.qty}</span>
                <strong className={styles.customerTradeDetailItemAmount}>{money(item.amount)}</strong>
              </div>)}
            </div> : <p className={styles.customerTradeDetailEmpty}>주문내역 없음</p>}
          </section>

          {detail.checkout && <section className={styles.customerTradeDetailSection}>
            <h3>금액 상세</h3>
            <dl className={styles.customerTradeDetailFacts}>
              <div><dt>주문금액</dt><dd>{money(detail.checkout.subtotalAmount)}</dd></div>
              {detail.checkout.discountAmount > 0 && <div><dt>할인금액</dt><dd>-{money(detail.checkout.discountAmount)}</dd></div>}
              <div><dt>할인 후 주문금액</dt><dd>{money(detail.checkout.totalAmount)}</dd></div>
              {detail.payment && <div><dt>이 결제금액</dt><dd>{money(detail.payment.amount)}</dd></div>}
              {detail.payment && detail.payment.appliedAmount !== detail.payment.amount &&
                <div><dt>주문에 적용된 금액</dt><dd>{money(detail.payment.appliedAmount)}</dd></div>}
              <div><dt>고객거래금액</dt><dd>{formatTradeBalance(entry.amount)}</dd></div>
            </dl>
          </section>}

          <section className={styles.customerTradeDetailSection}>
            <h3>고객잔액 변화</h3>
            <dl className={styles.customerTradeDetailFacts}>
              <div><dt>거래 전 잔액</dt><dd>{formatTradeBalance(detail.balanceBefore)}</dd></div>
              <div><dt>{entry.amount >= 0 ? "입금 / 증가" : "출금 / 감소"}</dt><dd>{formatTradeBalance(entry.amount)}</dd></div>
              <div className={styles.customerTradeDetailBalanceAfter}><dt>거래 후 잔액</dt><dd>{formatTradeBalance(entry.balance)}</dd></div>
            </dl>
          </section>
        </div>}
  </dialog>;
}
