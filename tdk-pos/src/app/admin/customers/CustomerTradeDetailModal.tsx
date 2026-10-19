"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomerTradeDetail, CustomerTradeDetailResponse } from "@/lib/customer-trade";
import { formatTradeBalance } from "@/lib/customer-trade";
import AdminBackLink from "@/app/pos/admin/AdminBackLink";
import OrderSummaryRows from "@/app/pos/OrderSummaryRows";
import type { SummaryRow } from "@/lib/pos-order-summary-rows";
import styles from "../admin.module.css";

const money = (amount: number) => amount.toLocaleString("ko-KR");
const tradeTime = (value: string) => value.replace("T", " ").slice(0, 16);

type CheckoutItem = NonNullable<CustomerTradeDetail["checkout"]>["items"][number];

function toSummaryRow(item: CheckoutItem, components: CheckoutItem[] = []): SummaryRow {
  return {
    rowKey: String(item.checkoutItemId),
    orderSequence: { orderId: item.orderId, orderItemId: item.orderItemId },
    name: item.name,
    qty: item.qty,
    total: item.amount,
    unitPrice: item.unitPrice,
    itemType: item.itemType,
    optionLabel: item.options.join(", "),
    components: components.map(component => ({
      rowKey: String(component.checkoutItemId),
      orderSequence: { orderId: component.orderId, orderItemId: component.orderItemId },
      name: component.name,
      qty: component.qty,
      total: component.amount,
      unitPrice: component.unitPrice,
      itemType: component.itemType,
      components: [],
    })),
  };
}

function buildSummaryRows(items: CheckoutItem[]): SummaryRow[] {
  const componentsByParent = new Map<number, CheckoutItem[]>();
  for (const item of items) {
    if (item.itemType !== "COMPONENT" || item.parentOrderItemId === null) continue;
    const children = componentsByParent.get(item.parentOrderItemId) ?? [];
    children.push(item);
    componentsByParent.set(item.parentOrderItemId, children);
  }
  const parents = items.filter(item => item.itemType !== "COMPONENT" || item.parentOrderItemId === null);
  return parents.map(item => toSummaryRow(item, componentsByParent.get(item.orderItemId) ?? []));
}

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
  const orderRows = detail?.checkout ? buildSummaryRows(detail.checkout.items) : [];

  return <dialog aria-labelledby="customer-trade-detail-title" className={styles.customerTradeDetailModal}
    onCancel={event => { event.preventDefault(); onClose(); }} ref={dialogRef}>
    <div className={styles.customerTradeHeader}>
      <AdminBackLink ariaLabel="거래관리로 돌아가기" iconSize={28} onNavigate={onClose} size={44} title="거래관리로 돌아가기" tone="lightPlain" />
      <h2 id="customer-trade-detail-title">거래 상세</h2>
    </div>
    {error ? <p className={styles.customerTradeError} role="alert">{error}</p>
      : !detail || !entry ? <p className={styles.customerTradeDetailLoading}>거래 상세를 불러오는 중입니다.</p>
        : <div className={styles.customerTradeDetailBody}>
          <div className={styles.customerTradeDetailBasic}>
            <time className={styles.customerTradeDetailTime} dateTime={entry.transactionAt}>{tradeTime(entry.transactionAt)}</time>
            <span>{detail.customerName}</span>
            <span>{detail.checkout?.place ?? "—"}</span>
          </div>

          <section className={styles.customerTradeDetailSection}>
            <h3>주문내역</h3>
            {orderRows.length ? <div className={styles.customerTradeDetailItems}>
              <OrderSummaryRows items={orderRows} />
            </div> : <p className={styles.customerTradeDetailEmpty}>주문내역 없음</p>}
            {detail.checkout && <div className={styles.customerTradeDetailOrderTotal}>
              <span>주문금액</span><strong>{money(detail.checkout.totalAmount)}원</strong>
            </div>}
          </section>

          <section className={styles.customerTradeDetailSection}>
            <h3>고객잔액 변화</h3>
            <dl className={styles.customerTradeDetailFacts}>
              <div><dt>거래 전 잔액</dt><dd>{formatTradeBalance(detail.balanceBefore)}원</dd></div>
              <div><dt>{entry.amount >= 0 ? "입금금액" : "지출금액"}</dt><dd>{money(Math.abs(entry.amount))}원</dd></div>
              <div><dt>거래 후 잔액</dt><dd>{formatTradeBalance(entry.balance)}원</dd></div>
            </dl>
          </section>
        </div>}
  </dialog>;
}
