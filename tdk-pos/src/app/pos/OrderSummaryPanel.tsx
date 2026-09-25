"use client";
import { useEffect, useState } from "react";
import PinInput from "@/components/PinInput";
import { formatMoney } from "@/lib/format-money";
import { PIN_LENGTH } from "@/lib/pin";
import { formatSessionElapsed } from "@/lib/session-time";
import PaymentModal from "./PaymentModal";
type SessionDiscount = {
  sessionId: number;
  discountType: "SNS_REVIEW" | "AMOUNT" | "PERCENT";
  label: string;
  discountAmount: string;
  discountRate: number | null;
};
type Table = {
  tableId: number;
  sessionId: number | null;
  tableNo: string;
  tableName: string | null;
  personCount: number | null;
  babyCount: number | null;
  openedAt: string | null;
  prepaidAmount: number;
  paymentTotal: number;
};
type Item = [string, { qty: number; total: number; unitPrice: number }];
type DetailItem = {
  orderItemId: number;
  menuId: number;
  itemName: string;
  qty: number;
  unitPrice: string;
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
};
export type PendingCartItem = {
  menuId: number;
  menuName: string;
  unitPrice: number;
  qty: number;
  options?: Array<{
    modifierGroupId: number;
    modifierOptionId: number;
    optionName: string;
    priceDelta: number;
    qty: number;
  }>;
};
const styles: Record<Tab, { bg: string; color: string; tint: string }> = {
  pending: { bg: "bg-[#DC2626]", color: "#DC2626", tint: "#FEF2F2" },
  summary: { bg: "bg-[#2563EB]", color: "#2563EB", tint: "#EFF6FF" },
  detail: { bg: "bg-[#7C3AED]", color: "#7C3AED", tint: "#F5F3FF" },
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
});
export default function OrderSummaryPanel({
  selected,
  items,
  total,
  cart,
  cartTotal,
  tab,
  setTab,
  submitCart,
  clearCart,
  adjustCartItem,
  submitting,
  submitError,
  orderDetails,
  workspaceResetVersion,
  selectionVersion,
  onBlockingUiChange,
  onCancellationSuccess,
  onPaymentCompleted,
  party,
  physicalSessionIds,
  discounts,
}: {
  selected: Table | null;
  items: Item[];
  total: number;
  cart: PendingCartItem[];
  cartTotal: number;
  tab: Tab;
  setTab: (t: Tab) => void;
  submitCart: () => void;
  clearCart: () => void;
  adjustCartItem: (i: PendingCartItem, d: number) => void;
  submitting: boolean;
  submitError: string;
  orderDetails: OrderDetail[];
  workspaceResetVersion: number;
  selectionVersion: number;
  onBlockingUiChange: (open: boolean) => void;
  onCancellationSuccess: () => void;
  onPaymentCompleted: () => void;
  party: {
    sessionIds: number[];
    tableNos: string[];
    totals: { adult: number; baby: number };
  } | null;
  physicalSessionIds: number[];
  discounts: SessionDiscount[];
}) {
  const sessionId = selected?.sessionId ?? null,
    key = `${workspaceResetVersion}:${selectionVersion}:${sessionId ?? "none"}:${tab}`,
    [state, setState] = useState<CancelState>(() => empty(key));
  const c = state.key === key ? state : empty(key);
  const details =
    sessionId === null
      ? []
      : orderDetails.filter((o) => o.sessionId === sessionId);
  const cancelables = details
    .flatMap((o) => o.items)
    .filter((i) => i.effectiveQty > 0);
  const draft = (i: DetailItem) =>
    c.draft[i.orderItemId] ?? { checked: false, keep: 1, touched: false };
  const chosen = cancelables
    .map((i) => ({ i, d: draft(i), qty: draft(i).keep }))
    .filter((x) => x.d.checked && x.qty > 0);
  const isFullOrderCancellation =
    cancelables.length > 0 &&
    cancelables.every((item) =>
      chosen.some(
        (value) =>
          value.i.orderItemId === item.orderItemId &&
          value.qty === item.effectiveQty,
      ),
    );
  const amount = chosen.reduce((s, x) => s + x.qty * Number(x.i.unitPrice), 0);
  void isFullOrderCancellation;
  const [now, setNow] = useState(0);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const blockingUiOpen = paymentOpen || c.confirm || c.reauth;
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
        cancelables.map((i) => [
          i.orderItemId,
          { checked: false, keep: 1, touched: false },
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
    update((x) => ({ ...x, busy: true, error: "" }));
    try {
      const r = await fetch("/api/order-items/cancellations/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancellations: chosen.map((x) => ({
            orderItemId: x.i.orderItemId,
            qty: x.qty,
          })),
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
        update((x) => ({
          ...x,
          busy: false,
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
  const rows = details.map((o, n) => (
    <section
      className="border-b border-violet-200 py-2 last:border-0"
      key={o.orderId}
    >
      <header className="flex items-baseline gap-1.5 border-b border-violet-100 pb-1 text-sm font-bold text-violet-800">
        <span>{n + 1}차 주문</span>
        <time className="font-medium text-violet-700">({time(o.orderedAt)})</time>
      </header>
      {o.items.map((i) => {
        const d = draft(i),
          selectable = c.mode && i.effectiveQty > 0,
          selectedForCancellation = selectable && d.checked,
          fullyCancelled = i.effectiveQty === 0,
          effectiveAmount = Number(i.unitPrice) * i.effectiveQty;
        return (
          <div
            className={`mt-2 rounded-lg ${selectable ? "cursor-pointer px-2 py-1 transition hover:bg-red-50" : ""} ${selectedForCancellation ? "bg-red-50 ring-1 ring-red-200" : ""}`}
            key={i.orderItemId}
            onClick={() => selectable && toggle(i)}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_52px_52px_68px] items-center gap-1 text-sm">
              <span
                className={`truncate font-medium ${selectedForCancellation ? "text-red-700 line-through" : fullyCancelled ? "text-slate-500 line-through" : ""}`}
              >
                {i.itemName}
              </span>
              <span
                className={`text-right ${fullyCancelled ? "text-slate-400" : "text-slate-500"}`}
              >
                {money(Number(i.unitPrice))}
              </span>
              {selectedForCancellation ? (
                <span className="grid grid-cols-[1.5rem_1fr_1.5rem] items-center text-center">
                  <button
                    disabled={d.keep <= 1}
                    onClick={(e) => {
                      e.stopPropagation();
                      edit(i, {
                        keep: Math.max(1, d.keep - 1),
                        checked: true,
                        touched: true,
                      });
                    }}
                    type="button"
                    className="size-6 rounded border border-red-200 bg-white font-bold text-red-700 disabled:opacity-40"
                  >
                    −
                  </button>
                  <b className="tabular-nums text-red-700">{d.keep}</b>
                  <button
                    disabled={d.keep >= i.effectiveQty}
                    onClick={(e) => {
                      e.stopPropagation();
                      edit(i, {
                        keep: Math.min(i.effectiveQty, d.keep + 1),
                        checked: true,
                        touched: true,
                      });
                    }}
                    type="button"
                    className="size-6 rounded border border-red-200 bg-white font-bold text-red-700 disabled:opacity-40"
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
  const summaryRows = items.map(([n, i]) => (
    <div className="grid grid-cols-[1fr_52px_76px_58px] gap-1 text-sm" key={n}>
      <span className="truncate font-medium">{n}</span>
      <span className="text-right text-slate-500">
        {new Intl.NumberFormat("ko-KR").format(i.unitPrice)}
      </span>
      <span className="text-center text-slate-500">× {i.qty}</span>
      <b className="text-right">{money(i.total)}</b>
    </div>
  ));
  const pendingRows = cart.map((i) => (
    <div
      className="grid grid-cols-[1fr_52px_76px_58px] items-center gap-1 text-sm"
      key={`${i.menuId}:${i.unitPrice}`}
    >
      <span className="truncate font-medium">{i.menuName}</span>
      <span className="text-right text-slate-500">
        {new Intl.NumberFormat("ko-KR").format(i.unitPrice)}
      </span>
      <span className="grid grid-cols-3 text-center">
        <button
          disabled={submitting}
          onClick={() => adjustCartItem(i, -1)}
          type="button"
        >
          −
        </button>
        <b>{i.qty}</b>
        <button
          disabled={submitting}
          onClick={() => adjustCartItem(i, 1)}
          type="button"
        >
          +
        </button>
      </span>
      <b className="text-right">{money(i.unitPrice * i.qty)}</b>
    </div>
  ));
  const partyItemMap = new Map<
    string,
    {
      menuId: number;
      itemName: string;
      unitPrice: number;
      qty: number;
      optionKey: string;
      optionLabel: string;
    }
  >();
  if (party) {
    orderDetails
      .filter((order) => party.sessionIds.includes(order.sessionId))
      .flatMap((order) => order.items)
      .filter((item) => item.effectiveQty > 0)
      .forEach((item) => {
        const options = item.options
          .slice()
          .sort(
            (a, b) =>
              (a.modifierOptionId ?? 0) - (b.modifierOptionId ?? 0) ||
              a.optionName.localeCompare(b.optionName, "ko"),
          );
        const optionKey = JSON.stringify(
          options.map((option) => [
            option.modifierOptionId,
            option.qty,
            option.unitPrice,
          ]),
        );
        const optionLabel = options
          .map((option) => option.optionName)
          .join(", ");
        const itemKey = `${item.menuId}:${item.unitPrice}:${optionKey}`;
        const current = partyItemMap.get(itemKey) ?? {
          menuId: item.menuId,
          itemName: item.itemName,
          unitPrice: Number(item.unitPrice),
          qty: 0,
          optionKey,
          optionLabel,
        };
        current.qty += item.effectiveQty;
        partyItemMap.set(itemKey, current);
      });
  }
  const orderGrossTotal =
    total +
    discounts
      .filter((discount) => physicalSessionIds.includes(discount.sessionId))
      .reduce((sum, discount) => sum + Number(discount.discountAmount), 0);
  const partyRows = [...partyItemMap.values()].sort(
    (a, b) =>
      a.itemName.localeCompare(b.itemName, "ko") ||
      a.optionKey.localeCompare(b.optionKey, "ko"),
  );
  const partyTotal = partyRows.reduce(
    (sum, item) => sum + item.unitPrice * item.qty,
    0,
  );
  const partyTableNos = party?.tableNos ?? [];
  const partyTotals = party?.totals ?? null;
  const partySessionIds = party?.sessionIds ?? [];
  const selectedDiscounts = discounts.filter((discount) =>
    physicalSessionIds.includes(discount.sessionId),
  );
  const partyDiscounts = discounts.filter((discount) =>
    partySessionIds.includes(discount.sessionId),
  );
  const discountRows = (entries: SessionDiscount[]) => {
    const effectiveEntries = entries.filter(
      (discount) => Number(discount.discountAmount) > 0,
    );
    return effectiveEntries.length ? (
      <div className="mt-3">
        {effectiveEntries.map((discount, index) => (
          <div
            className="flex justify-between text-sm text-red-600"
            key={`${discount.sessionId}:${discount.discountType}:${index}`}
          >
            <span>
              {discount.discountType === "SNS_REVIEW"
                ? "SNS 리뷰 할인"
                : discount.label}
            </span>
            <b>-{money(Number(discount.discountAmount))}</b>
          </div>
        ))}
      </div>
    ) : null;
  };
  const partyDiscountTotal = partyDiscounts.reduce(
    (sum, discount) => sum + Number(discount.discountAmount),
    0,
  );
  const partyNetTotal = Math.max(0, partyTotal - partyDiscountTotal);
  // The upper billing area always represents the selected physical table.
  // Party aggregates are displayed separately in the party-order section.
  const billingDiscounts = selectedDiscounts;
  const billingGrossTotal = orderGrossTotal;
  const hasBillingDiscount = billingDiscounts.some(
    (discount) => Number(discount.discountAmount) > 0,
  );
  const prepaidAmount = selected?.prepaidAmount ?? 0;
  const receivableAmount = Math.max(
    0,
    (selected?.paymentTotal ?? total) - prepaidAmount,
  );
  const prepaidRow = prepaidAmount > 0 ? (
    <div className="mt-2 flex justify-between text-sm text-blue-600">
      <span>선불금액</span>
      <b>- {money(prepaidAmount)}</b>
    </div>
  ) : null;
  const partyOrdersSection =
    partySessionIds.length > 0 ? (
      <section className="mt-5 border-t-2 border-violet-200 pt-3">
        <h3 className="mb-2 text-sm font-extrabold text-violet-800">
          일행 주문
        </h3>
        {tab !== "summary" && (
          <div className="grid grid-cols-[minmax(0,1fr)_52px_52px_68px] gap-1 border-b border-violet-100 pb-1 text-[11px] font-bold text-slate-500">
            <span>메뉴명</span>
            <span className="text-right">단가</span>
            <span className="text-center">수량</span>
            <span className="text-right">금액</span>
          </div>
        )}
        <div className="py-2">
          {partyRows.map((item) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_52px_52px_68px] items-center gap-1 py-1 text-sm"
              key={`${item.menuId}:${item.unitPrice}:${item.optionLabel}`}
            >
              <span className="min-w-0 truncate font-medium">
                {item.itemName}
                {item.optionLabel && (
                  <small className="ml-1 text-[10px] font-normal text-slate-500">
                    ({item.optionLabel})
                  </small>
                )}
              </span>
              <span className="text-right text-slate-500">
                {new Intl.NumberFormat("ko-KR").format(item.unitPrice)}
              </span>
              <span className="text-center text-slate-500">× {item.qty}</span>
              <b className="text-right">{money(item.unitPrice * item.qty)}</b>
            </div>
          ))}
        </div>
        {discountRows(partyDiscounts)}
        <div className="flex justify-between border-t border-violet-200 pt-3 text-base font-extrabold">
          <span>일행 주문 합계</span>
          <b className="text-xl font-extrabold text-violet-700">
            {money(partyNetTotal)}
          </b>
        </div>
      </section>
    ) : null;
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
        {selected && (
          <div className="mt-3 flex items-start gap-3 border-b border-slate-200 pb-2">
            <b className="shrink-0 text-[40px] leading-none">
              {selected.tableNo}
            </b>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-3">
                <b className="shrink-0 text-sm text-slate-500">테이블</b>
                {selected.sessionId && (
                  <p className="min-w-0 truncate text-[11px] text-slate-500">
                    이용 :{" "}
                    {selected.openedAt
                      ? `${formatSessionElapsed(selected.openedAt, now)}(${time(selected.openedAt)})`
                      : "-"}
                  </p>
                )}
                {selected.sessionId && (
                  <p className="ml-auto shrink-0 text-xs text-slate-500">
                    성인 {selected.personCount ?? 0}명
                    {partyTotals ? ` (=${partyTotals.adult}명)` : ""}
                  </p>
                )}
              </div>
              {selected.sessionId &&
                (partyTableNos.length > 0 ||
                selected.babyCount ||
                partyTotals?.baby ? (
                  <div className="mt-1 flex min-w-0 items-center gap-3">
                    {partyTableNos.length > 0 && (
                      <p className="min-w-0 truncate text-xs text-slate-500">
                        일행 {partyTableNos.map((no) => `+${no}T`).join(" ")}
                      </p>
                    )}
                    {selected.babyCount || partyTotals?.baby ? (
                      <p className="ml-auto shrink-0 text-xs text-slate-500">
                        아동 {selected.babyCount ?? 0}명
                        {partyTotals ? ` (=${partyTotals.baby}명)` : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null)}
            </div>
          </div>
        )}
        <div className="mt-3 grid grid-cols-[1fr_52px_76px_58px] border-b border-slate-200 pb-2 text-[11px] font-bold text-slate-500">
          <span>메뉴명</span>
          <span className="text-right">단가</span>
          <span className="text-center">수량</span>
          <span className="text-right">금액</span>
        </div>
        <div className="min-h-0 flex flex-1 flex-col">
          {tab === "summary" ? (
            <div className="pos-order-content">
              <div className="pos-order-items-scroll py-3">
                {summaryRows.length ? (
                  summaryRows
                ) : (
                  <p className="py-6 text-center text-sm text-slate-400">
                    현재 주문 내역이 없습니다.
                  </p>
                )}
                {hasBillingDiscount && <div className="mt-3 flex justify-between border-t border-blue-200 pt-3 text-base font-bold text-slate-700">
                  <span>주문합계</span>
                  <b>{money(billingGrossTotal)}</b>
                </div>}
                {discountRows(billingDiscounts)}
                {prepaidRow}
                <div className="mt-3 flex justify-between border-t border-blue-200 pt-3 text-base font-bold text-blue-700">
                  <span>받을금액</span>
                  <b className="text-lg font-extrabold">{money(receivableAmount)}</b>
                </div>
                {partyOrdersSection}
              </div>
            </div>
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
            <div className="pos-order-items-scroll min-h-0 flex-1 overflow-y-auto py-2">
              {rows.length ? (
                rows
              ) : (
                <p className="py-6 text-center text-sm text-slate-400">
                  현재 주문 내역이 없습니다.
                </p>
              )}
              {sessionId && hasBillingDiscount && (
                <div className="mt-3 flex justify-between pt-3 text-base font-bold text-slate-700">
                  <span>주문합계</span>
                  <b>{money(billingGrossTotal)}</b>
                </div>
              )}
              {discountRows(billingDiscounts)}
              {prepaidRow}
              <div className="mt-3 flex justify-between border-t border-violet-200 pt-3 text-base font-bold text-blue-700">
                <span>받을금액</span>
                <b className="text-lg font-extrabold">{money(receivableAmount)}</b>
              </div>
              {partyOrdersSection}
            </div>
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
                  className="min-h-14 rounded-xl bg-[#7C3AED] font-bold text-white disabled:opacity-50"
                  disabled={!chosen.length || c.busy}
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
                className="min-h-14 w-full rounded-xl bg-[#7C3AED] font-bold text-white disabled:opacity-50"
                disabled={!sessionId || !cancelables.length}
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
              className="min-h-14 w-full rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50"
              disabled={!selected?.sessionId || total <= 0}
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
                className="min-h-14 rounded-xl bg-blue-600 font-bold text-white"
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
          close={() => update((x) => ({ ...x, reauth: false, error: "" }))}
          set={(staffCode, pin) =>
            update((x) => ({ ...x, staffCode, pin, error: "" }))
          }
          submit={() => void execute({ staffCode: c.staffCode, pin: c.pin })}
        />
      )}
      {paymentOpen && selected?.sessionId && (
        <PaymentModal
          close={() => {
            setPaymentOpen(false);
            onCancellationSuccess();
          }}
          completed={() => {
            setPaymentOpen(false);
            onPaymentCompleted();
          }}
          tableId={selected.tableId}
          tableNo={selected.tableNo}
        />
      )}
    </section>
  );
}
function Confirm({
  c,
  chosen,
  amount,
  close,
  setReason,
  setDetail,
  submit,
}: {
  c: CancelState;
  chosen: Array<{ i: DetailItem; d: { keep: number }; qty: number }>;
  amount: number;
  close: () => void;
  setReason: (s: string) => void;
  setDetail: (s: string) => void;
  submit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <section className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
        <header className="flex items-center gap-3">
          <button
            aria-label="돌아가기"
            className="flex size-10 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
            onClick={close}
            title="돌아가기"
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="21"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="21"
            >
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-extrabold">건별 주문 취소</h2>
        </header>
        <section className="mt-5">
          <h3 className="text-sm font-bold">취소 내역</h3>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-200 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_72px_48px_80px] gap-2 border-b bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
              <span>메뉴명</span>
              <span className="text-right">단가</span>
              <span className="text-center">수량</span>
              <span className="text-right">금액</span>
            </div>
            {chosen.map((x) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_72px_48px_80px] gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0"
                key={x.i.orderItemId}
              >
                <span className="truncate font-medium">{x.i.itemName}</span>
                <span className="text-right">
                  {money(Number(x.i.unitPrice))}
                </span>
                <span className="text-center">{x.qty}</span>
                <b className="text-right">
                  {money(x.qty * Number(x.i.unitPrice))}
                </b>
              </div>
            ))}
          </div>
        </section>
        <div className="mt-4 flex justify-between border-t pt-3 font-bold">
          <span>취소금액</span>
          <b className="text-violet-700">{money(amount)}</b>
        </div>
        <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
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
          className="mt-5 min-h-12 w-full rounded-xl bg-[#7C3AED] font-bold text-white disabled:opacity-50"
          disabled={c.busy || (c.reason === "기타" && !c.detail.trim())}
          onClick={submit}
          type="button"
        >
          {c.busy ? "처리 중..." : "건별 주문 취소"}
        </button>
      </section>
    </div>
  );
}
function Reauth({
  c,
  close,
  set,
  submit,
}: {
  c: CancelState;
  close: () => void;
  set: (a: string, b: string) => void;
  submit: () => void;
}) {
  const [employees, setEmployees] = useState<
    Array<{ staffId: number; staffCode: string; name: string; role: string }>
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
            }>;
          }>,
      )
      .then((data) => {
        if (mounted) setEmployees(data.staff ?? []);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4">
      <section className="w-full max-w-sm rounded-2xl bg-white p-5">
        <h2 className="text-lg font-extrabold">취소자 재확인</h2>
        <p className="mt-2 text-sm">
          취소 담당 직원을 선택하고 PIN을 입력하세요.
        </p>
        {employees.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {employees.map((employee) => (
              <button
                className={`min-h-11 rounded-lg border px-2 text-sm font-bold ${c.staffCode === employee.staffCode ? "border-violet-600 bg-violet-50 text-violet-700" : "border-slate-200"}`}
                key={employee.staffId}
                onClick={() => set(employee.staffCode, c.pin)}
                type="button"
              >
                {employee.name}
              </button>
            ))}
          </div>
        ) : (
          <input
            autoFocus
            className="mt-4 min-h-11 w-full rounded-lg border px-3"
            onChange={(e) => set(e.target.value, c.pin)}
            placeholder="직원번호"
            value={c.staffCode}
          />
        )}
        <PinInput
          ariaLabel="취소자 PIN"
          autoFocus={employees.length > 0}
          disabled={c.busy}
          onChange={(pin) => set(c.staffCode, pin)}
          value={c.pin}
        />
        {c.error && <p className="mt-2 text-sm text-red-600">{c.error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            className="min-h-12 rounded-xl bg-slate-100 font-bold"
            onClick={close}
            type="button"
          >
            취소
          </button>
          <button
            className="min-h-12 rounded-xl bg-[#7C3AED] font-bold text-white disabled:opacity-50"
            disabled={!c.staffCode || c.pin.length !== PIN_LENGTH || c.busy}
            onClick={submit}
            type="button"
          >
            {c.busy ? "확인 중..." : "확인"}
          </button>
        </div>
      </section>
    </div>
  );
}
