"use client";
import { useEffect, useState } from "react";
import PinAuthPanel from "@/components/PinAuthPanel";
import PinKeypad from "@/components/PinKeypad";
import PinInput from "@/components/PinInput";
import { formatMoney } from "@/lib/format-money";
import { salePlaceLabel } from "@/lib/sale-place-label";
import { PIN_LENGTH } from "@/lib/pin";
import type { TableFinancials } from "@/lib/table-session-financials";
import { buildPartyOrderRows, type SummaryRow } from "@/lib/pos-order-summary-rows";
import PaymentModal from "./PaymentModal";
import CustomerSelectDialog, { type SelectedCustomer } from "./CustomerSelectDialog";
import PosSubHeader from "./PosSubHeader";
import OrderTableInfoHeader from "./OrderTableInfoHeader";
import OrderSummaryRows from "./OrderSummaryRows";
import OrderSummaryColumnHeader from "./OrderSummaryColumnHeader";
import { ORDER_INFO_STYLES } from "./order-info-styles";
type SessionDiscount = {
  sessionId: number;
  discountType: "SNS_REVIEW" | "AMOUNT" | "PERCENT";
  label: string;
  discountAmount: string;
  discountRate: number | null;
};
type Table = {
  tableId: number;
  sessionKind?: "DINE_IN" | "TAKEOUT_WALK_IN" | "TAKEOUT_PHONE";
  sessionId: number | null;
  groupId: number | null;
  tableNo: string;
  tableName: string | null;
  personCount: number | null;
  babyCount: number | null;
  openedAt: string | null;
  prepaidAmount: number;
  paymentTotal: number;
};
type DetailItem = {
  orderItemId: number;
  status: string;
  menuId: number;
  parentOrderItemId: number | null;
  itemType: "NORMAL" | "COMPONENT" | "SERVICE";
  itemName: string;
  qty: number;
  unitPrice: string;
  discountAmount: string;
  totalAmount: string;
  cancelledQty: number;
  effectiveQty: number;
  options: Array<{
    orderItemId: number;
    modifierOptionId: number | null;
    optionName: string;
    qty: number;
    unitPrice: string;
  }>;
  cancellations: Array<{
    cancellationId: number;
    cancelledQty: number;
    cancellationReason: string;
    cancelledAt: string;
  }>;
};
type OrderDetail = {
  orderId: number;
  sessionId: number;
  orderedAt: string;
  status: string;
  items: DetailItem[];
};
type Tab = "summary" | "pending" | "detail" | "table" | "kitchen";
type Draft = Record<
  number,
  { checked: boolean; keep: number; touched: boolean }
>;
type CancelState = {
  key: string;
  mode: boolean;
  draft: Draft;
  confirm: boolean;
  reauth: boolean;
  reason: string;
  detail: string;
  staffCode: string;
  pin: string;
  busy: boolean;
  error: string;
  pinError: boolean;
};
export type PendingCartComponent = {
  menuComponentId: number;
  componentMenuId: number;
  itemName: string;
  perMenuQty: number;
  qty: number;
  touched: boolean;
  unitPrice: number;
};
export type PendingCartItem = {
  menuId: number;
  menuName: string;
  unitPrice: number;
  qty: number;
  isComplimentary?: boolean;
  components?: PendingCartComponent[];
  options?: Array<{
    modifierGroupId: number;
    modifierOptionId: number;
    optionName: string;
    priceDelta: number;
    qty: number;
  }>;
};
export const pendingCartItemKey = (item: PendingCartItem) => {
  const componentSignature = (item.components ?? []).map(component => `${component.menuComponentId}:${component.touched ? `manual-${component.qty}` : "default"}`).join(",");
  return `${item.menuId}:${item.unitPrice}:${item.isComplimentary ? "complimentary" : "paid"}:${JSON.stringify(item.options ?? [])}:${componentSignature}`;
};
const styles: Record<Tab, { bg: string; color: string; tint: string }> = {
  pending: { bg: "bg-[#DC2626]", color: "#DC2626", tint: "#FEF2F2" },
  summary: ORDER_INFO_STYLES.summary,
  detail: ORDER_INFO_STYLES.detail,
  table: { bg: "bg-[#EA580C]", color: "#EA580C", tint: "#FFF7ED" },
  kitchen: { bg: "bg-[#2563EB]", color: "#2563EB", tint: "#EFF6FF" },
};
const tabs: [Tab, string][] = [
  ["pending", "주문예정"],
  ["summary", "주문합계"],
  ["detail", "주문상세"],
  ["table", "주문순서"],
  ["kitchen", "주방알림"],
];
const reasons = [
  "고객 요청",
  "주문 실수",
  "조리 불량",
  "이물질",
  "클레임",
  "기타",
];
const cancelDetailGridStyle = { gridTemplateColumns: "minmax(0, 1fr) 75px 40px 44px 96px" };
const money = (n: number) => formatMoney(n);
const time = (d: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(d));
const empty = (key: string): CancelState => ({
  key,
  mode: false,
  draft: {},
  confirm: false,
  reauth: false,
  reason: "고객 요청",
  detail: "",
  staffCode: "",
  pin: "",
  busy: false,
  error: "",
  pinError: false,
});
export default function OrderSummaryPanel({
  selected,
  customerSelectOpen,
  setCustomerSelectOpen,
  items,
  total,
  cart,
  cartTotal,
  tab,
  setTab,
  submitCart,
  clearCart,
  adjustCartItem,
  adjustCartComponent,
  submitting,
  submitError,
  orderDetails,
  workspaceResetVersion,
  selectionVersion,
  onBlockingUiChange,
  onCancellationSuccess,
  onPaymentCompleted,
  onCashPaymentRegistered,
  onBusinessOpeningRequired,
  onPrintReceipt,
  receiptPrinting,
  party,
  physicalSessionIds,
  sessionTableNos,
  discounts,
}: {
  selected: Table | null;
  customerSelectOpen: boolean;
  setCustomerSelectOpen: (open: boolean) => void;
  items: SummaryRow[];
  total: number;
  cart: PendingCartItem[];
  cartTotal: number;
  tab: Tab;
  setTab: (t: Tab) => void;
  submitCart: () => void;
  clearCart: () => void;
  adjustCartItem: (i: PendingCartItem, d: number) => void;
  adjustCartComponent: (parent: PendingCartItem, component: PendingCartComponent, d: number) => void;
  submitting: boolean;
  submitError: string;
  orderDetails: OrderDetail[];
  workspaceResetVersion: number;
  selectionVersion: number;
  onBlockingUiChange: (open: boolean) => void;
  onCancellationSuccess: () => void;
  onPaymentCompleted: () => void;
  onCashPaymentRegistered: () => void;
  onBusinessOpeningRequired: (retry: () => void) => boolean | void;
  onPrintReceipt: (checkoutId?: number, isReprint?: boolean) => Promise<void>;
  receiptPrinting: boolean;
  party: {
    sessionIds: number[];
    tableNos: string[];
    totals: { adult: number; baby: number };
    financials: TableFinancials;
  } | null;
  physicalSessionIds: number[];
  sessionTableNos: Record<number, string>;
  discounts: SessionDiscount[];
}) {
  const sessionId = selected?.sessionId ?? null,
    key = `${workspaceResetVersion}:${selectionVersion}:${sessionId ?? "none"}:${tab}`,
    [state, setState] = useState<CancelState>(() => empty(key));
  const c = state.key === key ? state : empty(key);
  const details =
    sessionId === null
      ? []
      : orderDetails
          .filter((o) => o.sessionId === sessionId)
          .slice()
          .sort((a, b) => a.orderId - b.orderId);
  const partySourceDetails = orderDetails
    .filter(order => party?.sessionIds.includes(order.sessionId) && order.sessionId !== sessionId)
    .slice()
    .sort((a, b) => a.orderId - b.orderId);
  const editableOrders = [...details, ...partySourceDetails].filter(order => order.status === "OPEN" || order.status === "ACCEPTED");
  const editableItems = editableOrders.flatMap(order => order.items.filter(item =>
    item.status !== "CANCELLED" && (item.parentOrderItemId === null ||
      order.items.some(parent => parent.orderItemId === item.parentOrderItemId && parent.status !== "CANCELLED")),
  ));
  const isFreeComponent = (item: DetailItem) => item.itemType === "COMPONENT" && item.parentOrderItemId !== null && Number(item.unitPrice) === 0 && item.cancelledQty === 0;
  const cancelables = editableItems.filter(item => item.effectiveQty > 0 && !isFreeComponent(item));
  const freeComponents = editableItems.filter(isFreeComponent);
  const draft = (i: DetailItem) =>
    c.draft[i.orderItemId] ?? { checked: false, keep: 1, touched: false };
  const chosen = cancelables
    .map((i) => ({ i, d: draft(i), qty: draft(i).keep }))
    .filter((x) => x.d.checked && x.qty > 0);
  const componentChanges = freeComponents
    .map(i => ({ i, quantity: draft(i).keep }))
    .filter(x => draft(x.i).checked && x.quantity !== x.i.effectiveQty);
  const isFullOrderCancellation =
    cancelables.length > 0 &&
    cancelables.every((item) =>
      chosen.some(
        (value) =>
          value.i.orderItemId === item.orderItemId &&
          value.qty === item.effectiveQty,
      ),
    );
  const amount = chosen.reduce((s, x) => s + (x.i.itemType === "SERVICE" ? 0 : x.qty * Number(x.i.unitPrice)), 0);
  void isFullOrderCancellation;
  const [now, setNow] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [customersByScope, setCustomersByScope] = useState<Record<string, SelectedCustomer | null>>({});
  const customerScopeKey = selected?.sessionId ? selected.groupId !== null ? `group:${selected.groupId}` : `session:${selected.sessionId}` : null;
  const selectedCustomer = customerScopeKey === null ? null : customersByScope[customerScopeKey] ?? null;
  const selectCustomer = (customer: SelectedCustomer | null) => {
    if (customerScopeKey !== null) setCustomersByScope(current => ({ ...current, [customerScopeKey]: customer }));
  };
  const blockingUiOpen = paymentOpen || customerSelectOpen || c.confirm || c.reauth;
  useEffect(() => {
    onBlockingUiChange(blockingUiOpen);
  }, [blockingUiOpen, onBlockingUiChange]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const frame = window.requestAnimationFrame(tick);
    const timer = window.setInterval(tick, 60000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);
  const update = (fn: (x: CancelState) => CancelState) =>
    setState((x) => fn(x.key === key ? x : empty(key)));
  const start = () =>
    update((x) => ({
      ...x,
      mode: true,
      draft: Object.fromEntries(
        editableItems.map((i) => [
          i.orderItemId,
          { checked: false, keep: isFreeComponent(i) ? i.effectiveQty : 1, touched: false },
        ]),
      ),
    }));
  const close = () => setState(empty(key));
  const edit = (
    i: DetailItem,
    v: Partial<{ checked: boolean; keep: number; touched: boolean }>,
  ) =>
    update((x) => ({
      ...x,
      draft: { ...x.draft, [i.orderItemId]: { ...draft(i), ...v } },
      error: "",
    }));
  const toggle = (i: DetailItem) => {
    const current = draft(i);
    edit(
      i,
      current.checked
        ? { checked: false, keep: 1, touched: false }
        : { checked: true, keep: i.effectiveQty, touched: true },
    );
  };
  const execute = async (credentials?: { staffCode: string; pin: string }) => {
    update((x) => ({ ...x, busy: true, error: "", pinError: false }));
    try {
      const r = await fetch("/api/order-items/cancellations/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancellations: chosen.map((x) => ({
            orderItemId: x.i.orderItemId,
            qty: x.qty,
          })),
          componentQuantities: componentChanges.map(x => ({ orderItemId: x.i.orderItemId, quantity: x.quantity })),
          currentSessionId: sessionId,
          reason: c.reason,
          detail: c.detail,
          ...credentials,
        }),
      });
      const v = (await r.json()) as {
        success?: boolean;
        reauth?: boolean;
        message?: string;
      };
      if (v.reauth) {
        update((x) => ({ ...x, busy: false, confirm: false, reauth: true }));
        return;
      }
      if (!r.ok || !v.success) {
        const pinError = r.status === 409 && Boolean(credentials);
        update((x) => ({
          ...x,
          busy: false,
          pin: pinError ? "" : x.pin,
          pinError,
          error: v.message ?? "주문 취소에 실패했습니다.",
        }));
        return;
      }
      close();
      onCancellationSuccess();
    } catch {
      update((x) => ({
        ...x,
        busy: false,
        error: "취소 처리 중 네트워크 오류가 발생했습니다.",
      }));
    }
  };
  const orderedItems = (items: DetailItem[]) => {
    const childrenByParent = new Map<number, DetailItem[]>();
    const roots: DetailItem[] = [];
    for (const item of items) {
      if (item.itemType === "COMPONENT" && item.parentOrderItemId !== null) {
        childrenByParent.set(item.parentOrderItemId, [
          ...(childrenByParent.get(item.parentOrderItemId) ?? []),
          item,
        ]);
      } else {
        roots.push(item);
      }
    }
    roots.sort((a, b) => a.orderItemId - b.orderItemId);
    for (const children of childrenByParent.values()) {
      children.sort((a, b) => a.orderItemId - b.orderItemId);
    }
    const attached = new Set<number>();
    const ordered = roots.flatMap((item) => {
      const children = childrenByParent.get(item.orderItemId) ?? [];
      children.forEach((child) => attached.add(child.orderItemId));
      return [item, ...children];
    });
    return [
      ...ordered,
      ...items.filter(
        (item) =>
          item.itemType === "COMPONENT" &&
          item.parentOrderItemId !== null &&
          !attached.has(item.orderItemId),
      ),
    ];
  };
  const renderDetailRows = (readOnly: boolean, scopedDetails = details, showTable = false) => scopedDetails.map((o, n) => (
    <section
      className="pos-display-copy border-b border-violet-200 py-2 last:border-0"
      key={o.orderId}
    >
      <header className="flex items-baseline gap-1.5 border-b border-violet-100 pb-1 text-sm font-bold text-violet-800">
        {showTable && <span>{sessionTableNos[o.sessionId] ? salePlaceLabel(sessionTableNos[o.sessionId]) : `세션 ${o.sessionId}`} ·</span>}
        <span>{scopedDetails.slice(0, n).filter(previous => previous.sessionId === o.sessionId).length + 1}차 주문</span>
        <time className="font-medium text-violet-700">({time(o.orderedAt)})</time>
      </header>
      {orderedItems(o.items).map((i) => {
        const d = draft(i),
          editableComponent = !readOnly && c.mode && isFreeComponent(i) && i.status !== "CANCELLED" &&
            o.items.some(parent => parent.orderItemId === i.parentOrderItemId && parent.status !== "CANCELLED") &&
            (o.status === "OPEN" || o.status === "ACCEPTED"),
          selectable = !readOnly && c.mode && (o.status === "OPEN" || o.status === "ACCEPTED") && i.status !== "CANCELLED" &&
            (i.parentOrderItemId === null || o.items.some(parent => parent.orderItemId === i.parentOrderItemId && parent.status !== "CANCELLED")) &&
            (editableComponent || i.effectiveQty > 0),
          selectedForCancellation = selectable && d.checked,
          fullyCancelled = i.status === "CANCELLED" || o.status === "CANCELLED" || (i.effectiveQty === 0 && i.cancelledQty > 0),
          effectiveAmount = i.itemType === "SERVICE" ? 0 : Number(i.unitPrice) * i.effectiveQty;
        return (
          <div
            className={`pos-display-copy mt-2 rounded-lg ${i.itemType === "COMPONENT" && i.parentOrderItemId !== null ? "ml-3" : ""} ${selectable ? "cursor-pointer px-2 py-1 transition hover:bg-red-50" : ""} ${selectedForCancellation ? "bg-red-50 ring-1 ring-red-200" : ""}`}
            key={i.orderItemId}
            onClick={() => selectable && (editableComponent
              ? edit(i, { checked: !d.checked, keep: i.effectiveQty, touched: true })
              : toggle(i))}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_52px_52px_68px] items-center gap-1 text-sm">
              <span
                className={`truncate font-medium ${selectedForCancellation ? (editableComponent ? "text-red-700" : "text-red-700 line-through") : fullyCancelled ? "text-slate-500 line-through" : ""}`}
              >
                {i.itemType === "COMPONENT" && i.parentOrderItemId !== null && <span aria-hidden="true" className="mr-1 text-slate-400">└</span>}
                {i.itemName}{i.itemType === "SERVICE" && <small className="ml-1 font-semibold text-blue-700">무료제공</small>}
              </span>
              <span
                className={`text-right ${fullyCancelled ? "text-slate-400" : "text-slate-500"}`}
              >
                {money(i.itemType === "SERVICE" ? 0 : Number(i.unitPrice))}
              </span>
              {selectedForCancellation ? (
                <span className="grid grid-cols-[1.5rem_1fr_1.5rem] items-center text-center">
                  <button
                    disabled={d.keep <= (editableComponent ? 0 : 1)}
                    onClick={(e) => {
                      e.stopPropagation();
                      edit(i, {
                        keep: Math.max(editableComponent ? 0 : 1, d.keep - 1),
                        checked: true,
                        touched: true,
                      });
                    }}
                    type="button"
                    className="size-6 rounded border border-red-200 bg-white font-bold text-red-700"
                  >
                    −
                  </button>
                  <b className="tabular-nums text-red-700">{d.keep}</b>
                  <button
                    disabled={d.keep >= (editableComponent ? i.qty : i.effectiveQty)}
                    onClick={(e) => {
                      e.stopPropagation();
                      edit(i, {
                        keep: Math.min(editableComponent ? i.qty : i.effectiveQty, d.keep + 1),
                        checked: true,
                        touched: true,
                      });
                    }}
                    type="button"
                    className="size-6 rounded border border-red-200 bg-white font-bold text-red-700"
                  >
                    +
                  </button>
                </span>
              ) : (
                <span
                  className={`text-center ${fullyCancelled ? "text-slate-400" : "text-slate-500"}`}
                >
                  ×{i.effectiveQty}
                </span>
              )}
              <b
                className={`text-right ${fullyCancelled ? "text-slate-400" : ""}`}
              >
                {money(effectiveAmount)}
              </b>
            </div>
            {i.cancelledQty > 0 && !fullyCancelled && (
              <p className="ml-2 mt-1 text-xs font-semibold text-violet-700">
                취소 완료 {i.cancelledQty}
              </p>
            )}
          </div>
        );
      })}
    </section>
  ));
  const rows = renderDetailRows(false);
  const pendingRows = cart.map((i) => (
    <div className="pos-display-copy space-y-1" key={pendingCartItemKey(i)}>
      <div className="grid grid-cols-[1fr_52px_76px_58px] items-center gap-1 text-sm">
        <span className="truncate font-medium">{i.menuName}{i.isComplimentary && <small className="ml-1 font-semibold text-blue-700">무료제공</small>}</span>
        <span className="text-right text-slate-500">{new Intl.NumberFormat("ko-KR").format(i.isComplimentary ? 0 : i.unitPrice)}</span>
        <span className="grid grid-cols-3 text-center"><button disabled={submitting} onClick={() => adjustCartItem(i, -1)} type="button">−</button><b>{i.qty}</b><button disabled={submitting} onClick={() => adjustCartItem(i, 1)} type="button">+</button></span>
        <b className="text-right">{money(i.isComplimentary ? 0 : i.unitPrice * i.qty)}</b>
      </div>
      {(i.components ?? []).map(component => <div className="grid grid-cols-[1fr_52px_76px_58px] items-center gap-1 pl-3 text-sm text-slate-600" key={component.menuComponentId}>
        <span className="truncate"><span aria-hidden="true" className="mr-1 text-slate-400">└</span>{component.itemName}</span><span className="text-right">{new Intl.NumberFormat("ko-KR").format(component.unitPrice)}</span>
        <span className="grid grid-cols-3 items-center text-center"><button aria-label={`${component.itemName} 수량 감소`} className="min-h-8" disabled={submitting || component.qty <= 0} onClick={() => adjustCartComponent(i, component, -1)} type="button">−</button><b>{component.qty}</b><button aria-label={`${component.itemName} 수량 증가`} className="min-h-8" disabled={submitting} onClick={() => adjustCartComponent(i, component, 1)} type="button">+</button></span>
        <b className="text-right">{money(component.unitPrice * component.qty)}</b>
      </div>)}
    </div>
  ));
  const partyRows = party
    ? buildPartyOrderRows(
        orderDetails
          .filter((order) => party.sessionIds.includes(order.sessionId))
          .flatMap((order) => order.items.map((item) => ({ ...item, orderId: order.orderId, sessionId: order.sessionId }))),
      )
    : [];
  const orderGrossTotal =
    total +
    discounts
      .filter((discount) => physicalSessionIds.includes(discount.sessionId))
      .reduce((sum, discount) => sum + Number(discount.discountAmount), 0);
  const partyTotal = partyRows.reduce(
    (sum, item) => sum + item.total + item.components.reduce((childSum, child) => childSum + child.total, 0),
    0,
  );
  const partyTableNos = party?.tableNos ?? [];
  const partyTotals = party?.totals ?? null;
  const partyFinancials = party?.financials ?? null;
  const partySessionIds = party?.sessionIds ?? [];
  const selectedDiscounts = discounts.filter((discount) =>
    physicalSessionIds.includes(discount.sessionId),
  );
  const partyDiscounts = discounts.filter((discount) =>
    partySessionIds.includes(discount.sessionId),
  );
  const partyGross = partyFinancials?.gross ?? partyTotal;
  const partyDiscountTotal = partyFinancials?.discount ?? partyDiscounts.reduce(
    (sum, discount) => sum + Number(discount.discountAmount),
    0,
  );
  const partyPrepaidTotal = partyFinancials?.prepaid ?? 0;
  const partyReceivable = partyFinancials?.remaining ?? Math.max(0, partyGross - partyDiscountTotal - partyPrepaidTotal);
  // The upper billing area always represents the selected physical table.
  // Party aggregates are displayed separately in the party-order section.
  const billingDiscounts = selectedDiscounts;
  const billingGrossTotal = orderGrossTotal;
  const billingDiscountTotal = billingDiscounts.reduce(
    (sum, discount) => sum + Math.max(0, Number(discount.discountAmount) || 0),
    0,
  );
  const hasBillingDiscount = billingDiscountTotal > 0;
  const prepaidAmount = selected?.prepaidAmount ?? 0;
  const receivableAmount = Math.max(
    0,
    (selected?.paymentTotal ?? total) - prepaidAmount,
  );
  const prepaidRow = prepaidAmount > 0 ? (
    <div className="mt-2 flex justify-between text-sm text-slate-900">
      <span>선불금액</span>
      <b className="text-blue-600">- {money(prepaidAmount)}</b>
    </div>
  ) : null;
  const partyOrdersSection = (viewTab: "summary" | "detail") =>
    partySessionIds.length > 0 ? (
      <section className="mt-5 border-t-2 border-violet-200 pt-3">
        <h3 className="mb-2 text-sm font-extrabold text-violet-800">
          일행 주문
        </h3>
        {viewTab !== "summary" && (
          <div className="grid grid-cols-[minmax(0,1fr)_52px_52px_68px] gap-1 border-b border-violet-100 pb-1 text-[11px] font-bold text-slate-500">
            <span>메뉴명</span>
            <span className="text-right">단가</span>
            <span className="text-center">수량</span>
            <span className="text-right">금액</span>
          </div>
        )}
        <div className="flex flex-col gap-y-[7px] py-2">
          {c.mode && viewTab === "detail" ? renderDetailRows(false, partySourceDetails, true) : partyRows.map((item) => (
            <div className="space-y-1" key={item.rowKey}>
              {[item, ...item.components].map((row, index) => (
                <div
                  className={`grid grid-cols-[minmax(0,1fr)_52px_52px_68px] items-center gap-1 text-sm ${index > 0 ? "pl-3 text-slate-600" : ""}`}
                  key={row.rowKey}
                >
                  <span className="min-w-0 truncate font-medium">
                    {index > 0 && <span aria-hidden="true" className="mr-1 text-slate-400">└</span>}
                    {row.name}
                    {row.optionLabel && (
                      <small className="ml-1 text-[10px] font-normal text-slate-500">
                        ({row.optionLabel})
                      </small>
                    )}
                  </span>
                  <span className="text-right text-slate-500">
                    {new Intl.NumberFormat("ko-KR").format(row.itemType === "SERVICE" ? 0 : row.unitPrice)}
                  </span>
                  <span className="text-center text-slate-500">× {row.qty}</span>
                  <b className="text-right">{money(row.total)}</b>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1 border-t border-violet-100 pt-3 text-sm">
          <div className="flex justify-between"><span>일행 주문금액</span><b>{money(partyGross)}</b></div>
          {partyDiscountTotal > 0 && <div className="flex justify-between"><span>할인금액</span><b className="text-red-600">- {money(partyDiscountTotal)}</b></div>}
          {partyPrepaidTotal > 0 && <div className="flex justify-between"><span>선불금액</span><b className="text-blue-600">- {money(partyPrepaidTotal)}</b></div>}
        </div>
        <div className="mt-2 flex justify-between border-t border-violet-200 pt-3 text-base font-extrabold">
          <span>일행 받을금액</span>
          <b className="text-xl font-extrabold text-violet-700">
            {money(partyReceivable)}
          </b>
        </div>
      </section>
    ) : null;
  const renderOrderContent = (viewTab: "summary" | "detail", readOnly = false) => (
    <div className={readOnly ? (viewTab === "summary" ? "py-3" : "py-2") : viewTab === "summary" ? "pos-order-content" : "pos-order-items-scroll min-h-0 flex-1 overflow-y-auto py-2"}>
      <div className={!readOnly && viewTab === "summary" ? "pos-order-items-scroll py-3" : ""}>
        {viewTab === "summary"
          ? items.length
            ? <OrderSummaryRows items={items} />
            : <p className="py-6 text-center text-sm text-slate-400">현재 주문 내역이 없습니다.</p>
          : details.length
            ? readOnly ? renderDetailRows(true) : rows
            : <p className="py-6 text-center text-sm text-slate-400">현재 주문 내역이 없습니다.</p>}
        {hasBillingDiscount && <>
          <div className={`mt-3 flex justify-between border-t ${viewTab === "summary" ? "border-blue-200" : "border-violet-200"} pt-3 text-base font-bold text-slate-700`}>
            <span>주문금액</span>
            <b>{money(billingGrossTotal)}</b>
          </div>
          <div className="mt-2 flex justify-between text-sm text-slate-900">
            <span>할인금액</span>
            <b className="text-red-600">- {money(billingDiscountTotal)}</b>
          </div>
        </>}
        {hasBillingDiscount && prepaidRow}
        <div className={`mt-3 flex justify-between border-t ${viewTab === "summary" ? "border-blue-200" : "border-violet-200"} pt-3 text-base font-bold text-slate-900`}>
          <span>받을금액</span>
          <b className="text-lg font-extrabold text-blue-700">{money(receivableAmount)}</b>
        </div>
        {partyOrdersSection(viewTab)}
      </div>
    </div>
  );
  return (
    <section className="relative flex min-h-0 flex-1 flex-col rounded-2xl bg-white p-4 shadow-sm">
      <nav className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map(([k, l]) => (
          <button
            className={`relative overflow-hidden rounded-lg py-2 text-[10px] font-bold ${tab === k ? `${styles[k].bg} text-white` : "border border-slate-200 bg-white text-slate-500"}`}
            key={k}
            onClick={() => setTab(k)}
            type="button"
          >
            <i
              className="absolute left-0 top-0 size-3 brightness-75 [clip-path:polygon(0_0,100%_0,0_100%)]"
              style={{ backgroundColor: styles[k].color }}
            />
            {l}
          </button>
        ))}
      </nav>
      <div className={`mt-1.5 h-[3px] rounded-full ${styles[tab].bg}`} />
      <div
        className="flex min-h-0 flex-1 flex-col rounded-xl px-2.5"
        style={{ backgroundColor: styles[tab].tint }}
      >
        <OrderTableInfoHeader selected={selected} selectedCustomer={selectedCustomer} partyTableNos={partyTableNos} partyTotals={partyTotals} now={now} onSelectCustomer={() => setCustomerSelectOpen(true)} />
        <OrderSummaryColumnHeader className="mt-3" />
        <div className="min-h-0 flex flex-1 flex-col">
          {tab === "summary" ? (
            renderOrderContent("summary")
          ) : tab === "pending" ? (
            <div className="pos-order-content">
              <div className="pos-order-items-scroll py-3">
                {pendingRows.length ? (
                  pendingRows
                ) : (
                  <p className="py-6 text-center text-sm text-slate-400">
                    현재 주문 예정 내역이 없습니다.
                  </p>
                )}
              </div>
              <div className="flex justify-between border-t border-red-200 pt-3 font-bold">
                <span>주문 예정 금액</span>
                <b className="text-blue-700">{money(cartTotal)}</b>
              </div>
              {submitError && (
                <p className="text-sm text-red-600">{submitError}</p>
              )}
            </div>
          ) : tab === "detail" ? (
            renderOrderContent("detail")
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">
              해당 기능은 준비 중입니다.
            </p>
          )}
        </div>
        {tab === "detail" &&
          (c.mode ? (
            <div className="shrink-0 pb-2.5 pt-3">
              <p className="mb-2 text-center text-sm font-medium text-violet-700">
                취소할 메뉴를 선택하고 유지 수량을 조절하세요.
              </p>
              {c.error && (
                <p className="mb-2 text-center text-sm text-red-600">
                  {c.error}
                </p>
              )}
              <div className="grid grid-cols-[35fr_65fr] gap-2">
                <button
                  className="min-h-14 rounded-xl bg-slate-100 font-bold"
                  disabled={c.busy}
                  onClick={close}
                  type="button"
                >
                  취소
                </button>
                <button
                  className="min-h-14 rounded-xl bg-[#7C3AED] font-bold text-white"
                  disabled={(!chosen.length && !componentChanges.length) || c.busy}
                  onClick={() => {
                    onBlockingUiChange(true);
                    update((x) => ({ ...x, confirm: true, error: "" }));
                  }}
                  type="button"
                >
                  주문취소 실행
                </button>
              </div>
            </div>
          ) : (
            <div className="shrink-0 pb-2.5 pt-3">
              <button
                className="min-h-14 w-full rounded-xl bg-[#7C3AED] font-bold text-white"
                disabled={!sessionId || (!cancelables.length && !freeComponents.length)}
                onClick={start}
                type="button"
              >
                주문취소
              </button>
            </div>
          ))}
        {tab === "summary" && (
          <div className="shrink-0 pb-2.5 pt-3">
            <button
              className="min-h-14 w-full rounded-xl bg-blue-600 font-bold text-white"
              disabled={!selected?.sessionId || (total <= 0 && selected.sessionKind !== "TAKEOUT_WALK_IN" && selected.sessionKind !== "TAKEOUT_PHONE")}
              onClick={() => {
                onBlockingUiChange(true);
                setPaymentOpen(true);
              }}
              type="button"
            >
              계산
            </button>
          </div>
        )}
        {tab === "pending" && (
          <div className="shrink-0 pb-2.5 pt-3">
            <div className="grid grid-cols-[35fr_65fr] gap-2">
              <button
                className="min-h-14 rounded-xl bg-slate-100 font-bold"
                disabled={!cart.length || submitting}
                onClick={clearCart}
                type="button"
              >
                취소
              </button>
              <button
                className="min-h-14 rounded-xl font-bold text-white"
                style={{ backgroundColor: styles[tab].color }}
                disabled={!cart.length || submitting}
                onClick={submitCart}
                type="button"
              >
                {submitting ? "주문 중..." : "주문"}
              </button>
            </div>
          </div>
        )}
      </div>
      {c.confirm && (
        <Confirm
          c={c}
          chosen={chosen}
          componentChanges={componentChanges}
          amount={amount}
          close={() => update((x) => ({ ...x, confirm: false, error: "" }))}
          setReason={(reason) => update((x) => ({ ...x, reason, error: "" }))}
          setDetail={(detail) => update((x) => ({ ...x, detail, error: "" }))}
          submit={() => void execute()}
        />
      )}{" "}
      {c.reauth && (
        <Reauth
          c={c}
          close={() => update((x) => ({ ...x, reauth: false, error: "", pinError: false }))}
          set={(staffCode, pin) =>
            update((x) => ({ ...x, staffCode, pin, error: "", pinError: false }))
          }
          dismissPinError={() => update((x) => ({ ...x, error: "", pinError: false }))}
          submit={(staffCode, pin) => void execute({ staffCode, pin })}
        />
      )}
      {paymentOpen && selected && (
        <PaymentModal
          orderDetails={orderDetails}
          renderOrderDetails={sessionIds => {
            const scopedDetails = orderDetails.filter(order => sessionIds.includes(order.sessionId) && order.status !== "CANCELLED").slice().sort((a, b) => a.orderId - b.orderId);
            return scopedDetails.length
              ? renderDetailRows(true, scopedDetails, true)
              : <p className="py-6 text-center text-sm text-slate-400">현재 주문 내역이 없습니다.</p>;
          }}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={selectCustomer}
          close={() => {
            setPaymentOpen(false);
            onCancellationSuccess();
          }}
          completed={() => {
            setPaymentOpen(false);
            onPaymentCompleted();
          }}
          onCashPaymentRegistered={onCashPaymentRegistered}
          onBusinessOpeningRequired={onBusinessOpeningRequired}
          onPrintReceipt={onPrintReceipt}
          receiptPrinting={receiptPrinting}
          tableId={selected.tableId}
          sessionId={selected.sessionKind && selected.sessionKind !== "DINE_IN" ? selected.sessionId ?? undefined : undefined}
          tableNo={selected.sessionKind && selected.sessionKind !== "DINE_IN" ? "포장" : selected.tableNo}
        />
      )}
      {customerSelectOpen && selected?.sessionId && (
        <CustomerSelectDialog
          selected={selectedCustomer}
          onClose={() => setCustomerSelectOpen(false)}
          onSelect={customer => { selectCustomer(customer); if (customer) setCustomerSelectOpen(false); }}
        />
      )}
    </section>
  );
}
function Confirm({
  c,
  chosen,
  componentChanges,
  amount,
  close,
  setReason,
  setDetail,
  submit,
}: {
  c: CancelState;
  chosen: Array<{ i: DetailItem; d: { keep: number }; qty: number }>;
  componentChanges: Array<{ i: DetailItem; quantity: number }>;
  amount: number;
  close: () => void;
  setReason: (s: string) => void;
  setDetail: (s: string) => void;
  submit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <section className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
        <PosSubHeader backLabel="돌아가기" onBack={close} title="건별 주문 취소" />
        <div className="p-5">
        <section className="mt-5">
          <h3 className="text-sm font-bold">취소 내역</h3>
          <div className="mt-2 flex max-h-48 flex-col overflow-hidden rounded-xl border border-slate-200">
            <div className="grid shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500" style={cancelDetailGridStyle}>
              <span>메뉴명</span>
              <span className="text-right">단가</span>
              <span className="col-start-4 text-center">수량</span>
              <span className="col-start-5 text-right">금액</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {chosen.map((x) => (
                <div
                  className="grid border-b border-slate-100 px-3 py-2 text-sm last:border-0"
                  key={x.i.orderItemId}
                  style={cancelDetailGridStyle}
                >
                  <span className="truncate font-medium">{x.i.itemName}</span>
                  <span className="text-right">
                    {money(Number(x.i.unitPrice))}
                  </span>
                  <span className="col-start-4 text-center">{x.qty}</span>
                  <b className="col-start-5 text-right">
                    {money(x.qty * Number(x.i.unitPrice))}
                  </b>
                </div>
              ))}
              {componentChanges.map(({ i, quantity }) => (
                <div className="grid border-b border-slate-100 px-3 py-2 text-sm last:border-0" key={`component:${i.orderItemId}`} style={cancelDetailGridStyle}>
                  <span className="truncate font-medium">{i.itemName} 제공수량</span>
                  <span className="text-right">0</span>
                  <span className="col-start-4 text-center">{i.effectiveQty} → {quantity}</span>
                  <b className="col-start-5 text-right">0</b>
                </div>
              ))}
            </div>
            <div className="grid min-h-[48px] shrink-0 items-center border-t border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold" style={cancelDetailGridStyle}>
              <span className="col-span-4 text-xs font-bold text-slate-500">취소금액</span>
              <b className="col-start-5 text-right font-extrabold text-violet-700">{money(amount)}</b>
            </div>
          </div>
        </section>
        <section className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-bold">취소사유</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {reasons.map((r, index) => (
              <button
                autoFocus={index === 0}
                className={`min-h-11 rounded-lg border text-sm font-bold ${c.reason === r ? "border-violet-600 bg-violet-50 text-violet-700" : "border-slate-300 bg-white text-slate-700"}`}
                key={r}
                onClick={() => setReason(r)}
                type="button"
              >
                {r}
              </button>
            ))}
          </div>
          {c.reason === "기타" && (
            <input
              className="mt-2 min-h-11 w-full rounded-lg border px-3"
              onChange={(e) => setDetail(e.target.value)}
              placeholder="취소사유를 입력하세요."
              value={c.detail}
            />
          )}
        </section>
        {c.error && <p className="mt-2 text-sm text-red-600">{c.error}</p>}
        <button
          className="mt-5 min-h-12 w-full rounded-xl bg-[#7C3AED] font-bold text-white"
          disabled={c.busy || (c.reason === "기타" && !c.detail.trim())}
          onClick={submit}
          type="button"
        >
          {c.busy ? "처리 중..." : "건별 주문 취소"}
        </button>
        </div>
      </section>
    </div>
  );
}
function Reauth({
  c,
  close,
  set,
  dismissPinError,
  submit,
}: {
  c: CancelState;
  close: () => void;
  set: (a: string, b: string) => void;
  dismissPinError: () => void;
  submit: (staffCode: string, pin: string) => void;
}) {
  const [employees, setEmployees] = useState<
    Array<{ staffId: number; staffCode: string; name: string; role: string; hasPin: boolean }>
  >([]);
  useEffect(() => {
    let mounted = true;
    void fetch("/api/staff/active")
      .then(
        (r) =>
          r.json() as Promise<{
            staff?: Array<{
              staffId: number;
              staffCode: string;
              name: string;
              role: string;
              hasPin: boolean;
            }>;
          }>,
      )
      .then((data) => {
        if (mounted) setEmployees((data.staff ?? []).filter(employee => employee.staffCode !== "000" && employee.hasPin));
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);
  const enterDigit = (digit: string) => {
    if (!c.staffCode || c.busy || c.pin.length >= PIN_LENGTH) return;
    const pin = `${c.pin}${digit}`;
    set(c.staffCode, pin);
    if (pin.length === PIN_LENGTH) submit(c.staffCode, pin);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-3">
      <section aria-label="취소자 재확인" aria-modal="true" className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[390px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl" role="dialog">
        <PosSubHeader backLabel="취소 인증 취소" onBack={close} title="취소자 재확인" />
        <p className="shrink-0 px-5 pt-3 text-center text-sm text-slate-600">직원 선택 후 PIN 확인</p>
        <PinAuthPanel
          label="직원 선택"
          people={employees}
          selectedCode={c.staffCode}
          selectionDisabled={c.busy}
          showLabels={false}
          largePeopleButtons
          spaciousPinGap
          scrollablePeople
          onSelect={(employee) => set(employee.staffCode, "")}
          emptyMessage="선택할 수 있는 직원이 없습니다."
          pinInput={
            <PinInput
              ariaLabel="취소자 PIN"
              autoFocus={Boolean(c.staffCode)}
              className="!min-h-[60px]"
              disabled={!c.staffCode || c.busy}
              keypadAligned
              onChange={(pin) => set(c.staffCode, pin)}
              onComplete={(pin) => c.staffCode && submit(c.staffCode, pin)}
              value={c.pin}
            />
          }
          keypad={
            <PinKeypad
              digitDisabled={!c.staffCode || c.busy || c.pin.length >= PIN_LENGTH}
              actionDisabled={!c.staffCode || c.busy || !c.pin.length}
              largeKeys
              onDigit={enterDigit}
              onBackspace={() => set(c.staffCode, c.pin.slice(0, -1))}
              onClear={() => set(c.staffCode, "")}
            />
          }
          footer={c.error && !c.pinError ? <p className="pt-2 text-center text-sm text-red-600">{c.error}</p> : undefined}
        />
        {c.pinError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/45 p-5">
            <section aria-label="PIN 오류" aria-modal="true" className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-xl" role="alertdialog">
              <h2 className="text-lg font-extrabold text-slate-800">PIN 오류</h2>
              <p className="mt-2 text-sm text-slate-600">직원 또는 PIN이 올바르지 않습니다.</p>
              <button className="mt-5 min-h-11 w-full rounded-xl bg-blue-600 font-bold text-white" onClick={dismissPinError} type="button">확인</button>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
