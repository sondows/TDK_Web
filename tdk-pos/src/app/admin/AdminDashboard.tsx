"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SaleDetail, SaleDetailResponse, SaleDisplayStatus, SaleListItem } from "@/lib/sales-types";
import AdminBackLink from "@/app/pos/admin/AdminBackLink";
import styles from "./admin.module.css";

type Summary = { total: number; totalCount: number; card: number; cardCount: number; cash: number; cashCount: number; other: number; otherCount: number; discount: number; discountCount: number; completedCount: number; cancelledCount: number };
type PaymentMethodOption = { paymentMethodId: number; methodName: string; methodCode: string; methodType: string };
type CorrectionCustomer = { customerId: number; displayName: string };
type DashboardResponse = { success: boolean; date?: string; summary?: Summary; sales?: SaleListItem[]; availableMethods?: PaymentMethodOption[]; customerPaymentMethodId?: number | null; correctionCustomers?: CorrectionCustomer[]; message?: string };
type PaymentOptionsResponse = Pick<DashboardResponse, "success" | "availableMethods" | "customerPaymentMethodId" | "correctionCustomers" | "message">;
const money = (value: number) => Math.round(value).toLocaleString("ko-KR");
const labels: Record<SaleDisplayStatus, string> = { COMPLETED: "결제완료", PARTIALLY_CANCELLED: "일부취소", CANCELLED: "전체취소", IN_PROGRESS: "진행중" };
const dateTime = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
const clockTime = (value: string) => dateTime(value).split(" ").slice(-1)[0];

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [selectedMethodId, setSelectedMethodId] = useState<number | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [correctionError, setCorrectionError] = useState("");
  const detailDialog = useRef<HTMLDialogElement>(null);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const methodDialog = useRef<HTMLDialogElement>(null);
  const methodConfirmDialog = useRef<HTMLDialogElement>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/dashboard", { cache: "no-store" });
      const result = await response.json() as DashboardResponse;
      if (!response.ok || !result.success) throw new Error(result.message ?? "오늘 판매내역을 불러올 수 없습니다.");
      setData(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "오늘 판매내역을 불러올 수 없습니다."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const openDetail = async (checkoutId: number) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/dashboard?checkoutId=${checkoutId}`, { cache: "no-store" });
      const result = await response.json() as SaleDetailResponse;
      if (!response.ok || !result.success || !result.sale) throw new Error(result.message ?? "거래 상세를 불러올 수 없습니다.");
      setDetail(result.sale);
      detailDialog.current?.showModal();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "거래 상세를 불러올 수 없습니다."); }
    finally { setBusy(false); }
  };
  const deleteSale = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setDeleteError("");
    try {
      const response = await fetch(`/api/admin/dashboard/sales/${detail.checkoutId}`, { method: "DELETE" });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "판매내역을 삭제할 수 없습니다.");
      confirmDialog.current?.close();
      detailDialog.current?.close();
      setDetail(null);
      setData(null);
      setLoading(true);
      await refresh();
    } catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "판매내역을 삭제할 수 없습니다."); }
    finally { setBusy(false); }
  };
  const editingPayment = detail?.payments.find(payment => payment.paymentId === editingPaymentId);
  const selectedMethod = data?.availableMethods?.find(method => method.paymentMethodId === selectedMethodId);
  const selectedCustomer = data?.correctionCustomers?.find(customer => customer.customerId === selectedCustomerId);
  const customerPaymentSelected = data?.customerPaymentMethodId != null && selectedMethodId === data.customerPaymentMethodId;
  const selectedMethodName = selectedCustomer?.displayName ?? selectedMethod?.methodName;
  const openMethodEditor = async (paymentId: number, paymentMethodId: number) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/dashboard?paymentOptions=1", { cache: "no-store" });
      const options = await response.json() as PaymentOptionsResponse;
      if (!response.ok || !options.success) throw new Error(options.message ?? "결제수단과 고객 목록을 불러오지 못했습니다.");
      setData(current => current ? { ...current, availableMethods: options.availableMethods, customerPaymentMethodId: options.customerPaymentMethodId, correctionCustomers: options.correctionCustomers } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "결제수단과 고객 목록을 불러오지 못했습니다.");
      setBusy(false);
      return;
    }
    setEditingPaymentId(paymentId);
    setSelectedMethodId(paymentMethodId);
    setSelectedCustomerId(null);
    setCorrectionError("");
    methodDialog.current?.showModal();
    setBusy(false);
  };
  const correctPaymentMethod = async () => {
    if (!detail || !editingPayment || !selectedMethodId || (!customerPaymentSelected && !selectedMethod) || (customerPaymentSelected && !selectedCustomer) || busy) return;
    setBusy(true);
    setCorrectionError("");
    try {
      const response = await fetch(`/api/admin/dashboard/sales/${detail.checkoutId}/payments/${editingPayment.paymentId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethodId: selectedMethodId, ...(customerPaymentSelected && selectedCustomer ? { customerId: selectedCustomer.customerId } : {}) }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "결제수단을 변경하지 못했습니다.");
      const detailResponse = await fetch(`/api/admin/dashboard?checkoutId=${detail.checkoutId}`, { cache: "no-store" });
      const detailResult = await detailResponse.json() as SaleDetailResponse;
      if (!detailResponse.ok || !detailResult.success || !detailResult.sale) throw new Error("판매 상세를 다시 불러오지 못했습니다.");
      setDetail(detailResult.sale);
      methodConfirmDialog.current?.close();
      methodDialog.current?.close();
      await refresh();
    } catch (cause) { setCorrectionError(cause instanceof Error ? cause.message : "결제수단을 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const summary = data?.summary;
  return <div className={styles.content}>
    <div className={styles.pageHeading}><h1>오늘 매출</h1><p className={styles.pageDescription}>오늘의 결제와 판매내역을 확인합니다.</p></div>
    {error && <p className={styles.dashboardError} role="alert">{error}</p>}
    <section className={styles.dashboardSummary} aria-label="오늘 매출 요약">
      {([
        { label: "오늘 총매출", amount: summary?.total, count: summary?.totalCount },
        { label: "카드", amount: summary?.card, count: summary?.cardCount },
        { label: "현금", amount: summary?.cash, count: summary?.cashCount },
        { label: "기타결제", amount: summary?.other, count: summary?.otherCount },
        { label: "할인", amount: summary?.discount, count: summary?.discountCount },
      ]).map(({ label, amount, count }) => <div className={styles.dashboardStat} key={label}><span>{label}</span><strong>{loading ? "—" : `${money(amount ?? 0)} (${count ?? 0})`}</strong></div>)}
      <div className={styles.dashboardStat}><span>결제완료 / 취소</span><strong>{loading ? "—" : `${summary?.completedCount ?? 0} / ${summary?.cancelledCount ?? 0}`}</strong></div>
    </section>
    <section className={styles.dashboardSales} aria-labelledby="today-sales-title">
      <div className={styles.dashboardSalesHeading}><h2 id="today-sales-title">오늘 판매내역</h2><span>{data?.date ?? ""}</span></div>
      <div className={styles.customerTableScroll}><table className={styles.customerTable}><thead><tr><th>시간</th><th>테이블</th><th>메뉴</th><th>결제금액</th><th>결제수단</th><th>거래상태</th></tr></thead>
        <tbody>{!loading && !data?.sales?.length ? <tr><td colSpan={6} className={styles.customerEmpty}>오늘 판매내역이 없습니다.</td></tr> : data?.sales?.map(sale =>
          <tr key={sale.checkoutId} className={styles.dashboardSaleRow} onClick={() => void openDetail(sale.checkoutId)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openDetail(sale.checkoutId); } }} role="button" tabIndex={0} aria-label={`${sale.tableLabel} ${sale.menuSummary} 거래 상세 보기`}>
            <td>{clockTime(sale.occurredAt)}</td><td>{sale.tableLabel}</td><td>{sale.menuSummary.replace(/ 외 (\d+)건$/, " 외 $1")}</td><td>{money(sale.totalAmount)}</td><td>{sale.paymentMethods}</td><td>{labels[sale.status]}</td>
          </tr>)}</tbody></table></div>
    </section>
    <dialog ref={detailDialog} className={`${styles.customerModal} ${styles.dashboardDetail}`} onClose={() => setDetail(null)}>
      {detail && <><div className={styles.customerModalHeader}><div className={styles.dashboardDetailTitle}><AdminBackLink ariaLabel="판매내역으로 돌아가기" title="판매내역으로 돌아가기" onNavigate={() => detailDialog.current?.close()} size={38} iconSize={20} /><h2>판매 상세</h2></div><div className={styles.dashboardHeaderActions}><button type="button" className={styles.staffDeleteButton} onClick={() => { setDeleteError(""); confirmDialog.current?.showModal(); }}>삭제</button></div></div>
        <div className={styles.dashboardDetailBody}>
          <dl className={styles.dashboardFacts}><div><dt>테이블</dt><dd>{detail.tableLabel}</dd></div><div><dt>주문시간</dt><dd>{dateTime(detail.orderedAt)}</dd></div><div><dt>결제상태</dt><dd>{labels[detail.displayStatus]}</dd></div></dl>
          <h3>메뉴</h3><div className={styles.customerTableScroll}><table className={styles.customerTable}><thead><tr><th>메뉴명</th><th>수량</th><th>금액</th></tr></thead><tbody>{detail.items.map((item, index) => <tr key={`${item.orderItemId}-${index}`}><td>{item.itemName}</td><td>{item.qty}</td><td>{money(item.amount)}</td></tr>)}</tbody></table></div>
          <dl className={styles.dashboardAmounts}><div><dt>주문금액</dt><dd>{money(detail.subtotalAmount)}</dd></div>{detail.discounts.map((discount, index) => <div key={index}><dt>{discount.label}</dt><dd>-{money(discount.amount)}</dd></div>)}{detail.discountAmount > 0 && <div><dt>할인금액</dt><dd>-{money(detail.discountAmount)}</dd></div>}<div><dt>최종 결제금액</dt><dd>{money(detail.totalAmount)}</dd></div></dl>
          <h3>결제수단</h3><div className={styles.dashboardPayments}>{detail.payments.map(payment => <div key={payment.paymentId}><span>{payment.method}{payment.customerDisplayName ? `(${payment.customerDisplayName})` : ""} · {payment.status === "APPROVED" ? "결제완료" : "취소"}</span><strong>{money(payment.appliedAmount)}</strong>{payment.status === "APPROVED" && <button type="button" className={styles.staffEditButton} disabled={busy} onClick={() => void openMethodEditor(payment.paymentId, payment.paymentMethodId)}>수정</button>}</div>)}</div>
        </div></>}
    </dialog>
    <dialog ref={confirmDialog} className={`${styles.customerModal} ${styles.staffDeleteConfirm}`}>
      <div className={styles.customerModalHeader}><h2>판매내역 삭제</h2></div>
      <div className={styles.staffDeleteConfirmText}>이 판매내역을 완전히 삭제하시겠습니까?<br />삭제된 판매내역은 매출 집계에서도 제외됩니다.</div>
      {deleteError && <p className={styles.dashboardError} role="alert">{deleteError}</p>}
      <div className={styles.customerModalFooter}><button type="button" className={styles.customerCancelButton} disabled={busy} onClick={() => confirmDialog.current?.close()}>취소</button><button type="button" className={styles.staffDeleteConfirmButton} disabled={busy} onClick={() => void deleteSale()}>{busy ? "삭제 중..." : "삭제"}</button></div>
    </dialog>
    <dialog ref={methodDialog} className={`${styles.customerModal} ${styles.staffDeleteConfirm}`} onClose={() => { setEditingPaymentId(null); setSelectedMethodId(null); setSelectedCustomerId(null); setCorrectionError(""); }}>
      <div className={styles.customerModalHeader}><div className={styles.dashboardDetailTitle}><AdminBackLink ariaLabel="판매 상세로 돌아가기" title="판매 상세로 돌아가기" onNavigate={() => methodDialog.current?.close()} size={38} iconSize={20} /><h2>결제수단 변경</h2></div></div>
      <div className={styles.paymentMethodChoices}>
        <p>현재: {editingPayment?.method ?? ""}</p>
        <div className={styles.paymentMethodGroup}>
          {data?.availableMethods?.filter(method => method.methodCode === "CARD" || method.methodCode === "CASH").sort((a, b) => (a.methodCode === "CARD" ? 0 : 1) - (b.methodCode === "CARD" ? 0 : 1)).map(method => <button key={method.paymentMethodId} type="button" className={`${styles.paymentMethodChoice} ${selectedMethodId === method.paymentMethodId && !selectedCustomerId ? styles.paymentMethodChoiceSelected : ""}`} onClick={() => { setSelectedMethodId(method.paymentMethodId); setSelectedCustomerId(null); }}>{method.methodName}</button>)}
        </div>
        <div className={styles.paymentMethodGroup}>
          {data?.availableMethods?.filter(method => method.methodCode !== "CARD" && method.methodCode !== "CASH").map(method => <button key={method.paymentMethodId} type="button" className={`${styles.paymentMethodChoice} ${selectedMethodId === method.paymentMethodId && !selectedCustomerId ? styles.paymentMethodChoiceSelected : ""}`} onClick={() => { setSelectedMethodId(method.paymentMethodId); setSelectedCustomerId(null); }}>{method.methodName}</button>)}
        </div>
        <div className={`${styles.paymentMethodGroup} ${styles.customerPaymentOptions}`}>
          {data?.correctionCustomers?.map(customer => <button key={customer.customerId} type="button" disabled={!data.customerPaymentMethodId} className={`${styles.paymentMethodChoice} ${selectedCustomerId === customer.customerId ? styles.paymentMethodChoiceSelected : ""}`} onClick={() => { setSelectedMethodId(data.customerPaymentMethodId ?? null); setSelectedCustomerId(customer.customerId); }}>{customer.displayName}</button>)}
        </div>
      </div>
      {correctionError && <p className={styles.dashboardError} role="alert">{correctionError}</p>}
      <div className={styles.customerModalFooter}>
        <button type="button" className={styles.customerSubmitButton} disabled={busy || !selectedMethodId || (!customerPaymentSelected && !selectedMethod) || (customerPaymentSelected && !selectedCustomer) || (selectedMethodId === editingPayment?.paymentMethodId && !selectedCustomerId)} onClick={() => { setCorrectionError(""); methodConfirmDialog.current?.showModal(); }}>변경</button>
      </div>
    </dialog>
    <dialog ref={methodConfirmDialog} className={`${styles.customerModal} ${styles.staffDeleteConfirm}`}>
      <div className={styles.customerModalHeader}><h2>결제수단 변경 확인</h2></div>
      <div className={styles.staffDeleteConfirmText}>결제수단을 {editingPayment?.method} → {selectedMethodName}(으)로 변경하시겠습니까?<br />매출 집계의 결제수단도 함께 변경됩니다.</div>
      {correctionError && <p className={styles.dashboardError} role="alert">{correctionError}</p>}
      <div className={styles.customerModalFooter}>
        <button type="button" className={styles.customerCancelButton} disabled={busy} onClick={() => methodConfirmDialog.current?.close()}>취소</button>
        <button type="button" className={styles.customerSubmitButton} disabled={busy} onClick={() => void correctPaymentMethod()}>{busy ? "변경 중..." : "변경"}</button>
      </div>
    </dialog>
  </div>;
}
