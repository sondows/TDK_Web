import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { CustomerSummary } from "@/lib/customer";
import styles from "../admin.module.css";

const columns = ["이름", "전화", "이메일", "거래잔액", "거래관리", "수정"];
const emptyValue = "—";

export default function CustomerList({
  customers,
  canReorder,
  error,
  loading,
  onEdit,
  onOrder,
  onTrade,
  search,
}: {
  customers: CustomerSummary[];
  canReorder: boolean;
  error: string;
  loading: boolean;
  onEdit: (customer: CustomerSummary) => void;
  onOrder: (customerIds: number[]) => Promise<boolean>;
  onTrade: (customer: CustomerSummary) => void;
  search: string;
}) {
  const [orderedCustomers, setOrderedCustomers] = useState(customers);
  const [draggingCustomerId, setDraggingCustomerId] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<{ customerId: number; before: boolean } | null>(null);
  const [orderError, setOrderError] = useState("");
  const orderedRef = useRef(orderedCustomers);
  const pointerRef = useRef<{ pointerId: number; customerId: number } | null>(null);
  const didMoveRef = useRef(false);

  useEffect(() => {
    orderedRef.current = customers;
    setOrderedCustomers(customers);
  }, [customers]);

  const moveDraggedCustomer = (event: PointerEvent<HTMLButtonElement>) => {
    const active = pointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-customer-id]");
    const targetId = Number(target?.dataset.customerId);
    if (!targetId || targetId === active.customerId) return;
    const targetBounds = target?.getBoundingClientRect();
    if (!targetBounds) return;
    const before = event.clientY < targetBounds.top + targetBounds.height / 2;
    setDropHint({ customerId: targetId, before });
    const current = orderedRef.current;
    const fromIndex = current.findIndex(customer => customer.customerId === active.customerId);
    const targetIndex = current.findIndex(customer => customer.customerId === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    let insertionIndex = targetIndex + (before ? 0 : 1);
    if (fromIndex < insertionIndex) insertionIndex -= 1;
    if (fromIndex === insertionIndex) return;
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(insertionIndex, 0, moved);
    orderedRef.current = next;
    didMoveRef.current = true;
    setOrderedCustomers(next);
  };

  const finishDrag = async (event: PointerEvent<HTMLButtonElement>, canceled: boolean) => {
    const active = pointerRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    setDraggingCustomerId(null);
    setDropHint(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* capture may already be released */ }
    if (canceled) {
      didMoveRef.current = false;
      orderedRef.current = customers;
      setOrderedCustomers(customers);
      return;
    }
    if (!didMoveRef.current) return;
    didMoveRef.current = false;
    const saved = await onOrder(orderedRef.current.map(customer => customer.customerId));
    if (!saved) {
      orderedRef.current = customers;
      setOrderedCustomers(customers);
      setOrderError("고객 표시 순서를 저장하지 못했습니다. 새로고침 후 다시 시도해주세요.");
    } else {
      setOrderError("");
    }
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, customerId: number) => {
    if (!canReorder || event.button !== 0) return;
    event.preventDefault();
    pointerRef.current = { pointerId: event.pointerId, customerId };
    didMoveRef.current = false;
    setDraggingCustomerId(customerId);
    setOrderError("");
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const emptyMessage = loading
    ? "고객 목록을 불러오는 중입니다."
    : error || (search.trim() ? "검색 결과가 없습니다." : "등록된 고객이 없습니다.");

  return (
    <div className={styles.customerTableScroll}>
      {orderError && <p className={styles.customerOrderError} role="alert">{orderError}</p>}
      <table className={styles.customerTable}>
        <thead>
          <tr><th aria-label="순서" />{columns.map(column => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {loading || error || customers.length === 0 ? (
            <tr>
              <td className={styles.customerEmpty} colSpan={columns.length + 1}>{emptyMessage}</td>
            </tr>
          ) : orderedCustomers.map(customer => {
            const name = customer.name?.trim() ?? "";
            const contactName = customer.contactName?.trim() ?? "";
            const phone = customer.phone?.trim() ?? "";
            const displayName = name
              ? contactName ? `${name} (${contactName})` : name
              : phone || emptyValue;
            const displayPhone = !name && phone ? emptyValue : phone || emptyValue;
            const balance = customer.tradeBalance;
            const balanceClass = balance > 0
              ? styles.customerPositiveBalance
              : balance < 0 ? styles.customerNegativeBalance : styles.customerZeroBalance;

            return (
              <tr className={`${!customer.isActive ? styles.customerInactiveRow : ""} ${draggingCustomerId === customer.customerId ? styles.customerDraggingRow : ""} ${dropHint?.customerId === customer.customerId ? dropHint.before ? styles.customerDropBefore : styles.customerDropAfter : ""}`} data-customer-id={customer.customerId} key={customer.customerId}>
                <td className={styles.customerDragCell}>
                  <button
                    aria-label={`${displayName} 순서 이동`}
                    className={styles.customerDragHandle}
                    disabled={!canReorder || loading || Boolean(error)}
                    aria-pressed={draggingCustomerId === customer.customerId}
                    onPointerCancel={event => { void finishDrag(event, true); }}
                    onPointerDown={event => startDrag(event, customer.customerId)}
                    onPointerMove={moveDraggedCustomer}
                    onPointerUp={event => { void finishDrag(event, false); }}
                    title={canReorder ? "드래그하여 순서 변경" : search.trim() ? "검색 중에는 순서를 바꿀 수 없습니다" : "미사용 포함을 켜면 전체 고객 순서를 바꿀 수 있습니다"}
                    type="button"
                  >
                    <span aria-hidden="true">≡</span>
                  </button>
                </td>
                <td className={styles.customerName}>{displayName}</td>
                <td>{displayPhone}</td>
                <td>{customer.email || emptyValue}</td>
                <td className={balanceClass}>{balance > 0 ? "+" : balance < 0 ? "−" : ""}{Math.abs(balance).toLocaleString("ko-KR")}</td>
                <td><button className={styles.customerPaymentBadge} onClick={() => onTrade(customer)} type="button">거래관리</button></td>
                <td>
                  <button className={styles.staffEditButton} onClick={() => onEdit(customer)} type="button">
                    수정
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
