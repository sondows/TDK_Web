"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMoney as formatPosMoney } from "@/lib/format-money";
import { buildOrderSummaryRows } from "@/lib/pos-order-summary-rows";
import { partyPeerTableNos } from "@/lib/pos-party-peers";
import { formatSessionElapsed } from "@/lib/session-time";
import { openCashDrawer } from "@/lib/cash-drawer";
import { printReceipt } from "@/lib/receipt-print";
import { requestSystemShutdown } from "@/lib/system-shutdown";
import { requestPosExit } from "@/lib/pos-exit";
import LogoutButton from "./LogoutButton";
import TableShape from "./TableShape";
import TableLayoutCanvas from "./TableLayoutCanvas";
import OrderSummaryPanel, { pendingCartItemKey, type PendingCartComponent, type PendingCartItem } from "./OrderSummaryPanel";
import RequestMessagePanel from "./RequestMessagePanel";
import PersonCountModal from "./PersonCountModal";
import DiscountModal from "./DiscountModal";
import RiceStockModal from "./RiceStockModal";
import PosSubHeader from "./PosSubHeader";
import PosFooterBar from "./PosFooterBar";
import AdminBackLink from "./admin/AdminBackLink";
import { useHorizontalScroll } from "@/hooks/useHorizontalScroll";
import { posMainFixedTablePosition } from "@/lib/table-layout";
import { sumTableFinancials, type TableFinancials } from "@/lib/table-session-financials";
type Table = { tableId: number; tableNo: string; tableName: string | null; capacity: number; positionX: number; positionY: number; layoutWidth: number; layoutHeight: number; rotation: number; amountDue: number; prepaidAmount: number; paymentTotal: number; sessionId: number | null; groupId: number | null; personCount: number | null; babyCount: number | null; openedAt: string | null; mergedSourceTableNos: string[]; mergedSourceSessionIds: number[]; hasQrOrder?: boolean; qrLanguageCode?: string | null; customerName?: string | null };
type Menu = { menuId: number; categoryId: number | null; name: string; price: string; countsAsPerson: number; categoryName: string | null; imageUrl: string | null };
type MenuComponent = { menuComponentId: number; menuId: number; componentMenuId: number; itemName: string; price: string; quantity: number; printOnKitchen: number; printOnReceipt: number; sortOrder: number };
type SelectedMenuComponent = { menuComponentId: number; qty: number };
type Category = { categoryId: number; name: string };
type MenuModifier = { menuId: number; modifierGroupId: number; groupName: string; groupSortOrder: number; modifierOptionId: number; optionName: string; priceDelta: string; optionSortOrder: number };
type Order = { sessionId: number; orderId: number; orderedAt: Date; status: string };
type OrderItem = { orderItemId: number; orderId: number; menuId: number; parentOrderItemId: number | null; itemName: string; qty: number; unitPrice: string; discountAmount: string; totalAmount: string; status: string; itemType: "NORMAL" | "COMPONENT" | "SERVICE" };
type OrderDetail = { orderId: number; sessionId: number; orderedAt: string; status: string; items: Array<OrderItem & { cancelledQty: number; effectiveQty: number; options: Array<{ orderItemId: number; modifierOptionId: number | null; optionName: string; qty: number; unitPrice: string }>; cancellations: Array<{ cancellationId: number; orderItemId: number; cancelledQty: number; cancelledAmount: string; cancellationReason: string; cancelledAt: string; cancelledByStaffId: number }> }> };
type SessionDiscount = { sessionId: number; discountType: "SNS_REVIEW" | "AMOUNT" | "PERCENT"; label: string; discountAmount: string; discountRate: number | null };
type SessionFinancial = TableFinancials & { sessionId: number };
type QuickDiscount = { ruleId: number; slot: number; title: string; type: "AMOUNT" | "PERCENT"; value: number };
const text = { store: "탑동김치찌개", businessClose: "영업마감", exit: "종료", order: "주문합계", detail: "주문상세", table: "테이블별", kitchen: "주방" };
const viewTabStyles = {
 tables: { activeClass: "bg-[#2563EB]", color: "#2563EB" },
 takeout: { activeClass: "bg-[#16A34A]", color: "#16A34A" },
 reservation: { activeClass: "bg-[#7C3AED]", color: "#7C3AED" },
 waiting: { activeClass: "bg-[#EA580C]", color: "#EA580C" },
} as const;
const categoryVisuals: Record<string, { color: string }> = {
 "김치찌개": { color: "#DC2626" },
 "사이드": { color: "#16A34A" },
 "주류·음료": { color: "#0891B2" },
 "추가": { color: "#EA580C" },
 "포장": { color: "#7C3AED" },
};
const categoryVisual = (name: string | null | undefined) => categoryVisuals[name ?? ""] ?? { color: "#64748B" };
const categoryDisplayName = (name: string) => ({ "김치찌개": "찌개", "사이드": "단품", "주류·음료": "음료" }[name] ?? name);
const legacyDomRendering = process.env.NEXT_PUBLIC_LEGACY_POS_DOM === "enabled";
const legacyOrderSummaryRendering = process.env.NEXT_PUBLIC_LEGACY_ORDER_SUMMARY === "enabled";
const legacyMenuRendering = process.env.NEXT_PUBLIC_LEGACY_MENU_DOM === "enabled";
const countOpenTables = (tables: Table[]) => tables.filter(table => table.sessionId !== null).length;
const physicalTableSessionIds = (table: Table): number[] => table.sessionId === null ? [] : [...new Set([table.sessionId, ...table.mergedSourceSessionIds])];
export default function PosShell({ staffName, staffRole, tables, menus, menuComponents, categories, menuModifiers, orders, orderItems, orderDetails, discounts, sessionFinancials, quickDiscounts: _quickDiscounts, idleResetSeconds, riceCurrentQty }: { staffName: string; staffRole: "OWNER" | "MANAGER" | "STAFF" | "SHARED"; tables: Table[]; menus: Menu[]; menuComponents: MenuComponent[]; categories: Category[]; menuModifiers: MenuModifier[]; orders: Order[]; orderItems: OrderItem[]; orderDetails: OrderDetail[]; discounts: SessionDiscount[]; sessionFinancials: SessionFinancial[]; quickDiscounts: QuickDiscount[]; idleResetSeconds: number; riceCurrentQty: number | null }) {
 void _quickDiscounts;
 const [orderSummaryBlockingUiOpen, setOrderSummaryBlockingUiOpen] = useState(false);
 const receiptPrintingRef = useRef(false);
 const drawerOpeningRef = useRef(false);
 const [drawerOpening, setDrawerOpening] = useState(false);
 const [receiptPrinting, setReceiptPrinting] = useState(false);
 const [receiptNotice, setReceiptNotice] = useState<{ title: string; message: string; success: boolean } | null>(null);
 const [exitDialogOpen, setExitDialogOpen] = useState(false);
 const [posExitConfirmOpen, setPosExitConfirmOpen] = useState(false);
 const [posExitBusy, setPosExitBusy] = useState(false);
 const [shutdownConfirmOpen, setShutdownConfirmOpen] = useState(false);
 const [shutdownBusy, setShutdownBusy] = useState(false);
 const [exitMessage, setExitMessage] = useState("");

 const router = useRouter(); const searchParams = useSearchParams(); const refreshedOnTableManagementReturn = useRef(false); const [selectedId, setSelectedId] = useState<number | null>(null); const [selectionVersion, setSelectionVersion] = useState(0); const [view, setView] = useState<"tables"|"takeout"|"reservation"|"waiting">("tables"); const [tab, setTab] = useState<"summary" | "pending" | "detail" | "table" | "kitchen">("summary"); const [fullscreen, setFullscreen] = useState(false); const [personModal, setPersonModal] = useState(false); const [discountModal, setDiscountModal] = useState(false); const [riceStockModal, setRiceStockModal] = useState(false); const [personBusy, setPersonBusy] = useState(false); const [personError, setPersonError] = useState(""); const [cart, setCart] = useState<PendingCartItem[]>([]); const [quantityMenu, setQuantityMenu] = useState<Menu | null>(null); const [submittingOrder, setSubmittingOrder] = useState(false); const [orderError, setOrderError] = useState(""); const [menuResetVersion, setMenuResetVersion] = useState(0); const [tableOverrides, setTableOverrides] = useState<Record<number, Partial<Table>>>({}); const displayTables = tables.map(table => ({ ...table, ...tableOverrides[table.tableId] })); const openTableCount = countOpenTables(displayTables);
 useEffect(() => {
  if (riceCurrentQty === null) return;
  let active = true;
  let checking = false;
  const checkRiceQty = async () => {
   if (!active || checking || document.visibilityState === "hidden") return;
   checking = true;
   try {
    const response = await fetch("/api/pos/rice-stock?summary=1", { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json() as { currentQty?: number };
    if (active && result.currentQty !== riceCurrentQty) router.refresh();
   } catch { /* The next focus or interval will retry. */ }
   finally { checking = false; }
  };
  const onFocus = () => { void checkRiceQty(); };
  window.addEventListener("focus", onFocus);
  const interval = window.setInterval(() => void checkRiceQty(), 30_000);
  return () => { active = false; window.removeEventListener("focus", onFocus); window.clearInterval(interval); };
 }, [riceCurrentQty, router]);
 const selected = selectedId === null ? null : displayTables.find(t => t.tableId === selectedId) ?? null;
 const sendReceipt = useCallback(async (target: { tableId: number; isReprint?: boolean }) => {
  if (receiptPrintingRef.current) return;
  receiptPrintingRef.current = true;
  setReceiptPrinting(true);
  try {
   await printReceipt(target);
  } catch (error) {
   console.error("Receipt print failed", error);
   setReceiptNotice({ title: "영수증 출력 실패", message: error instanceof Error ? error.message : "영수증을 출력할 수 없습니다.\n프린터 및 Device Agent 연결을 확인해주세요.", success: false });
  } finally {
   receiptPrintingRef.current = false;
   setReceiptPrinting(false);
  }
 }, []);
 const printSelectedReceipt = useCallback(async () => {
  if (view !== "tables" || !selected?.tableId) {
   setReceiptNotice({ title: "영수증 출력", message: "출력할 테이블을 먼저 선택해 주세요.", success: false });
   return;
  }
  await sendReceipt({ tableId: selected.tableId });
 }, [selected?.tableId, view, sendReceipt]);
 const selectedGroupId = selected?.sessionId && selected.groupId !== null ? selected.groupId : null;
 const selectedParty = useMemo(() => {
  if (selectedGroupId === null) return null;
  const partyTables = displayTables.filter(table => table.sessionId !== null && table.groupId === selectedGroupId);
  const sessionFinancialById = new Map(sessionFinancials.map(financial => [financial.sessionId, financial]));
  const sessionIds = [...new Set(partyTables.flatMap(physicalTableSessionIds))];
  return {
   sessionIds,
   financials: sumTableFinancials(sessionIds.flatMap(sessionId => {
    const financial = sessionFinancialById.get(sessionId);
    return financial ? [financial] : [];
   })),
   tableNos: partyTables.filter(table => table.tableId !== selected?.tableId).map(table => table.tableNo).sort((a, b) => a.localeCompare(b, "ko", { numeric: true })),
   totals: partyTables.reduce((totals, table) => ({ adult: totals.adult + (table.personCount ?? 0), baby: totals.baby + (table.babyCount ?? 0) }), { adult: 0, baby: 0 }),
  };
 }, [displayTables, sessionFinancials, selected?.tableId, selectedGroupId]);
 const canOrderMenu = view !== "tables" || Boolean(selected);
 const [firstOrderPersonModal, setFirstOrderPersonModal] = useState(false);
 const [firstOrderBusy, setFirstOrderBusy] = useState(false);
 const [firstOrderError, setFirstOrderError] = useState("");
 const isBlockingUiOpen = personModal || discountModal || riceStockModal || firstOrderPersonModal || quantityMenu !== null || orderSummaryBlockingUiOpen || receiptNotice !== null;
 const selectedPhysicalSessionIds = useMemo(() => selected ? physicalTableSessionIds(selected) : [], [selected]); const items = useMemo(() => buildOrderSummaryRows(orderDetails.filter(order => selectedPhysicalSessionIds.includes(order.sessionId)).flatMap(order => order.items)), [selectedPhysicalSessionIds, orderDetails]); const physicalAggregateTotal = items.reduce((sum, item) => sum + item.total, 0); const selectedDiscounts = useMemo(() => discounts.filter(discount => selectedPhysicalSessionIds.includes(discount.sessionId)), [discounts, selectedPhysicalSessionIds]); const appliedDiscountTotal = selectedDiscounts.reduce((sum, discount) => sum + Number(discount.discountAmount), 0); const displayTotal = Math.max(0, physicalAggregateTotal - appliedDiscountTotal); const cartTotal = cart.reduce((sum, item) => sum + (item.isComplimentary ? 0 : item.unitPrice * item.qty) + (item.components ?? []).reduce((componentSum, component) => componentSum + component.unitPrice * component.qty, 0), 0);
 const componentsForMenu = (menuId: number) => menuComponents.filter(component => component.menuId === menuId);
 const addToCart = (menu: Menu, unitPrice: number, qty: number, options: PendingCartItem["options"] = [], selectedComponents?: SelectedMenuComponent[], isComplimentary = false) => {
  const configuredComponents = componentsForMenu(menu.menuId);
  const selectedQtyById = new Map(selectedComponents?.map(component => [component.menuComponentId, component.qty]) ?? []);
  const components: PendingCartComponent[] = configuredComponents.map(component => {
   const defaultQty = component.quantity * qty;
   const componentQty = selectedQtyById.get(component.menuComponentId) ?? defaultQty;
   return { menuComponentId: component.menuComponentId, componentMenuId: component.componentMenuId, itemName: component.itemName, perMenuQty: component.quantity, qty: componentQty, touched: componentQty !== defaultQty, unitPrice: 0 };
  });
  const newItem: PendingCartItem = { menuId: menu.menuId, menuName: menu.name, unitPrice, qty, options, components, isComplimentary };
  const newItemKey = pendingCartItemKey(newItem);
  setCart(current => {
   const matchingIndex = current.findIndex(item => pendingCartItemKey(item) === newItemKey);
   if (matchingIndex < 0) return [...current, newItem];
   return current.map((item, index) => index === matchingIndex ? { ...item, qty: item.qty + qty, components: (item.components ?? []).map(component => component.touched ? component : { ...component, qty: Math.max(0, component.qty + component.perMenuQty * qty) }) } : item);
  });
  setOrderError("");
  setTab("pending");
 };
 const firstOrderAdultCount = cart.reduce((count, item) => count + (menus.find(menu => menu.menuId === item.menuId)?.countsAsPerson === 1 ? item.qty : 0), 0);
 const saveCartToSession = async (sessionId: number) => {
  try {
   const response = await fetch(`/api/table-sessions/${sessionId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: cart.map(item => ({ menuId: item.menuId, qty: item.qty, isComplimentary: item.isComplimentary === true, components: (item.components ?? []).map(component => ({ menuComponentId: component.menuComponentId, qty: component.qty })) })) }) });
   const result = await response.json() as { success?: boolean; message?: string };
   return response.ok && result.success ? null : result.message ?? "주문 저장에 실패했습니다.";
  } catch { return "주문 저장 중 네트워크 오류가 발생했습니다."; }
 };
 const submitCart = async () => {
  if (!selected || !cart.length || submittingOrder) { if (!selected) setOrderError("주문할 테이블을 선택하세요."); return; }
  if (view === "tables" && !selected.sessionId) { setFirstOrderError(""); setFirstOrderPersonModal(true); return; }
  if (!selected.sessionId) { setOrderError("주문할 사용 중 테이블을 선택하세요."); return; }
  setSubmittingOrder(true); setOrderError("");
  const message = await saveCartToSession(selected.sessionId);
  if (message) setOrderError(message); else { setCart([]); setTab("summary"); router.refresh(); }
  setSubmittingOrder(false);
 };
 const defaultCartOptions = (menu: Menu): PendingCartItem["options"] => {
  const modifiers = menuModifiers.filter(modifier => modifier.menuId === menu.menuId);
  const spiceGroup = modifiers.find(modifier => modifier.groupName === "매운맛");
  const spiceOptions = modifiers.filter(modifier => modifier.modifierGroupId === spiceGroup?.modifierGroupId).sort((a, b) => a.optionSortOrder - b.optionSortOrder);
  const selectedSpice = spiceOptions.find(option => option.optionName === "약간매운맛") ?? spiceOptions[0];
  return selectedSpice ? [{ modifierGroupId: selectedSpice.modifierGroupId, modifierOptionId: selectedSpice.modifierOptionId, optionName: selectedSpice.optionName, priceDelta: Number(selectedSpice.priceDelta), qty: 1 }] : [];
 };
 const quickAddToCart = (menu: Menu) => { if (!canOrderMenu) return; addToCart(menu, Number(menu.price), 1, defaultCartOptions(menu)); };
 const openQuantityModal = (menu: Menu) => { if (canOrderMenu) setQuantityMenu(menu); };
 const adjustCartItem = (target: PendingCartItem, delta: number) => {
  const targetKey = pendingCartItemKey(target);
  setCart(current => current.flatMap(item => {
   const itemKey = pendingCartItemKey(item);
   if (itemKey !== targetKey) return [item];
   const qty = item.qty + delta;
   return qty > 0 ? [{ ...item, qty, components: (item.components ?? []).map(component => component.touched ? component : { ...component, qty: Math.max(0, component.qty + component.perMenuQty * delta) }) }] : [];
  }));
  setOrderError("");
 };
 const adjustCartComponent = (parent: PendingCartItem, target: PendingCartComponent, delta: number) => {
  const parentKey = pendingCartItemKey(parent);
  setCart(current => current.map(item => {
   if (pendingCartItemKey(item) !== parentKey) return item;
   return { ...item, components: (item.components ?? []).map(component => component.menuComponentId === target.menuComponentId ? { ...component, qty: Math.max(0, component.qty + delta), touched: true } : component) };
  }));
  setOrderError("");
 };
 useEffect(() => { const sync = () => setFullscreen(document.fullscreenElement !== null); sync(); document.addEventListener("fullscreenchange", sync); return () => document.removeEventListener("fullscreenchange", sync); }, []);
 useEffect(() => {
  if (searchParams.get("refreshTables") !== "1") {
   refreshedOnTableManagementReturn.current = false;
   return;
  }
  if (refreshedOnTableManagementReturn.current) return;
  refreshedOnTableManagementReturn.current = true;
  setTableOverrides({});
  const selectedTableId = Number(searchParams.get("selectedTableId"));
  if (Number.isInteger(selectedTableId) && selectedTableId > 0) {
   setSelectedId(selectedTableId);
   setSelectionVersion(version => version + 1);
   setTab("summary");
  }
  router.refresh();
  window.history.replaceState(null, "", "/pos");
 }, [router, searchParams]);
 const resetPosWorkspace = useCallback(() => { setSelectedId(null); setSelectionVersion(version => version + 1); setFirstOrderPersonModal(false); setFirstOrderBusy(false); setFirstOrderError(""); setCart([]); setQuantityMenu(null); setDiscountModal(false); setOrderError(""); setTab("summary"); setMenuResetVersion(version => version + 1); }, []);
 const handleOpenCashDrawer = useCallback(async () => {
  if (drawerOpeningRef.current) return;
  drawerOpeningRef.current = true;
  setDrawerOpening(true);
  try {
   await openCashDrawer();
  } catch (error) {
   console.error("Cash drawer open failed", error);
   setReceiptNotice({ title: "금고 열기 실패", message: "금고를 열 수 없습니다.\n프린터 및 Device Agent 연결을 확인해주세요.", success: false });
  } finally {
   // Keep both manual clicks and automatic cash-payment opens behind the Agent's 1.5s debounce.
   await new Promise<void>(resolve => window.setTimeout(resolve, 1500));
   drawerOpeningRef.current = false;
   setDrawerOpening(false);
  }
 }, []);
 const handlePaymentCompleted = useCallback(() => {
  const completedTableId = selected?.tableId;
  setTableOverrides({});
  resetPosWorkspace();
  router.refresh();
  // Payment is already committed before receipt data is requested or printed.
  if (completedTableId) void sendReceipt({ tableId: completedTableId, isReprint: false });
 }, [resetPosWorkspace, router, selected?.tableId, sendReceipt]);
 const changeWorkTab = (nextView: typeof view) => { if (nextView === view) return; resetPosWorkspace(); setView(nextView); };
 useEffect(() => {
  if (!Number.isInteger(idleResetSeconds) || idleResetSeconds <= 0 || isBlockingUiOpen) return;
  let timer: number | undefined;
  const restartTimer = () => { if (timer) window.clearTimeout(timer); timer = window.setTimeout(resetPosWorkspace, idleResetSeconds * 1000); };
  const activityEvents: (keyof WindowEventMap)[] = ["pointerdown", "touchstart", "keydown", "wheel", "scroll"];
  activityEvents.forEach(eventName => window.addEventListener(eventName, restartTimer, { capture: true, passive: eventName !== "keydown" }));
  restartTimer();
  return () => { if (timer) window.clearTimeout(timer); activityEvents.forEach(eventName => window.removeEventListener(eventName, restartTimer, { capture: true })); };
 }, [idleResetSeconds, isBlockingUiOpen, resetPosWorkspace]);
 useEffect(() => {
  const clock = document.querySelector("main.h-dvh > div > div.flex.min-h-0.flex-col.gap-3 > section:first-child time");
  if (!clock) return;
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const updateClock = () => {
   const now = new Date();
   const date = `${now.getMonth() + 1}월 ${now.getDate()}일 (${weekdays[now.getDay()]})`;
   const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
   clock.innerHTML = `<span class="pos-clock-date">${date}</span><strong class="pos-clock-time">${time}</strong>`;
  };
  updateClock();
  const timer = window.setInterval(updateClock, 60_000);
  return () => window.clearInterval(timer);
 }, [router]);
 useEffect(() => {
  // The order card is React-owned; do not imperatively insert/remove its children.
  // Selection is rendered from state by the JSX below.
  if (!legacyDomRendering) return;
  const orderCard = document.querySelector("main.h-dvh > div > div.flex.min-h-0.flex-col.gap-3 > section:nth-child(2)");
  const tabs = orderCard?.querySelector("nav");
  if (!orderCard || !tabs) return;
  const info = document.createElement("div");
  info.className = "pos-table-info";
  const escape = (value: string) => value.replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
  const render = () => {
   if (!selected?.sessionId || !selected.openedAt) { info.textContent = "테이블을 선택하세요"; return; }
   const opened = new Date(selected.openedAt);
   const stay = formatSessionElapsed(selected.openedAt);
   const totalPeople = (selected.personCount ?? 0) + (selected.babyCount ?? 0);
   const people = `성인 ${selected.personCount ?? 0}명${selected.babyCount ? ` · 유아 ${selected.babyCount}명` : ""} · 총 ${totalPeople}명`;
   const openedAt = `${String(opened.getHours()).padStart(2, "0")}:${String(opened.getMinutes()).padStart(2, "0")}`;
   const companions = selected.groupId ? displayTables.filter(table => table.sessionId && table.groupId === selected.groupId).sort((a, b) => a.tableNo.localeCompare(b.tableNo, "ko", { numeric: true })).map(table => table.tableNo) : [];
   const partyText = companions.length ? ` - 일행 ${escape(companions.join("·"))}` : "";
   info.innerHTML = `<div class="pos-table-info-layout"><div class="pos-table-number">${escape(selected.tableNo)}</div><div class="pos-table-info-copy"><div class="pos-table-info-title">테이블${partyText}</div><p>${people}</p><p>이용시간 <strong class="pos-table-stay">${stay}</strong> <small>(${openedAt})</small></p></div></div>`;
  };
  render(); tabs.before(info);
  const timer = window.setInterval(render, 60_000);
  return () => { window.clearInterval(timer); info.remove(); };
 }, [selected, displayTables]);
 useEffect(() => {
 // React owns the order list as well; changing selectedId must not rewrite innerHTML.
  if (!legacyOrderSummaryRendering) return;
  const orderCard = document.querySelector("main.h-dvh > div > div.flex.min-h-0.flex-col.gap-3 > section:nth-child(2)");
  const list = orderCard?.querySelector("div.mt-3.min-h-0.flex-1.overflow-y-auto") as HTMLDivElement | null;
  const selectedTitle = list?.previousElementSibling as HTMLElement | null;
  const footer = list?.nextElementSibling as HTMLElement | null;
  if (!list || !selectedTitle || !footer) return;
  if (tab !== "summary") { selectedTitle.style.display = ""; footer.style.display = ""; return; }
  selectedTitle.style.display = "none";
  footer.style.display = "none";
  if (!selected?.sessionId) { list.innerHTML = "<p class=\"pos-order-empty\">테이블을 선택하세요</p>"; return; }
  const escape = (value: string) => value.replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
  const aggregate = (sessionIds: number[]) => {
   const orderIds = new Set(orders.filter(order => sessionIds.includes(order.sessionId)).map(order => order.orderId));
   const grouped = new Map<string, { qty: number; total: number }>();
   orderItems.filter(item => orderIds.has(item.orderId) && item.status !== "CANCELLED").forEach(item => { const old = grouped.get(item.itemName) ?? { qty: 0, total: 0 }; old.qty += item.qty; old.total += Number(item.totalAmount); grouped.set(item.itemName, old); });
   return [...grouped.entries()];
  };
  const formatMoney = (value: number) => formatPosMoney(value);
  const renderBlock = (heading: string | null, rows: [string, { qty: number; total: number }][], totalLabel: string) => {
   const sum = rows.reduce((value, [, row]) => value + row.total, 0);
   const rowHtml = rows.length ? rows.map(([name, row]) => `<div class=\"pos-order-row\"><div class=\"pos-menu-and-qty\"><span title=\"${escape(name)}\">${escape(name)}</span><span>× <b>${row.qty}</b></span></div><strong>${formatMoney(row.total)}</strong></div>`).join("") : "<p class=\"pos-order-empty\">주문 내역이 없습니다.</p>";
   return `${heading ? `<h3 class=\"pos-order-heading\">${heading}</h3>` : ""}<div class=\"pos-order-columns\"><span>메뉴 · 수량</span><span>금액</span></div><div class=\"pos-order-rows\">${rowHtml}</div><div class=\"pos-order-total\"><span>${totalLabel}</span><strong>${formatMoney(sum)}</strong></div>`;
  };
  const currentRows = aggregate([selected.sessionId]);
  const partySessions = selected.groupId ? displayTables.filter(table => table.sessionId && table.groupId === selected.groupId).map(table => table.sessionId as number) : [];
  const currentLabel = partySessions.length ? `${escape(selected.tableNo)}번 테이블 합계` : "합계";
  const partyBlock = partySessions.length ? `<div class=\"pos-party-orders\">${renderBlock("일행테이블 주문합계", aggregate(partySessions), "일행 합계")}</div>` : "";
  list.innerHTML = renderBlock(null, currentRows, currentLabel) + partyBlock;
  return () => { selectedTitle.style.display = ""; footer.style.display = ""; };
 }, [tab, selected, displayTables, orders, orderItems]);
 useEffect(() => {
  if (!legacyDomRendering) return;
  const bar = document.querySelector("main.h-dvh > div > section.col-span-2.grid-cols-6") as HTMLElement | null;
  if (!bar) return;
  const svg = (paths: string) => `<svg aria-hidden=\"true\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\">${paths}</svg>`;
  const buttons = [
   ["관리", svg("<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.08A1.7 1.7 0 0 0 10.68 18.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7.02 14.7 1.7 1.7 0 0 0 5.46 13.7H5.4v-3h.08A1.7 1.7 0 0 0 7.02 9.68 1.7 1.7 0 0 0 6.68 7.8l-.06-.06L8.74 5.6l.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 4.44V4.4h3v.08A1.7 1.7 0 0 0 15.72 6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03h.06v3h-.08A1.7 1.7 0 0 0 19.4 15Z\"/>")],
   ["CashBox", svg("<path d=\"M3 8h18v11H3z\"/><path d=\"M6 8V5h12v3M7 13h4\"/><circle cx=\"17\" cy=\"14\" r=\"1\"/>")],
   ["청구서", svg("<path d=\"M6 3h9l3 3v15H6z\"/><path d=\"M15 3v4h4M9 12h6M9 16h6\"/>")],
   ["영수증", svg("<path d=\"M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z\"/><path d=\"M9 8h6M9 12h6M9 16h4\"/>")],
   ["테이블정보", svg("<rect x=\"4\" y=\"5\" width=\"16\" height=\"11\" rx=\"1\"/><path d=\"M8 16v3M16 16v3M10 9h4M12 7v4\"/>")],
   ["할인", svg("<circle cx=\"7\" cy=\"7\" r=\"2\"/><circle cx=\"17\" cy=\"17\" r=\"2\"/><path d=\"m6 18 12-12\"/>")],
   ["계산", svg("<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2\"/><path d=\"M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01\"/>")],
  ];
  bar.className = "col-span-2 pos-function-bar";
  bar.innerHTML = buttons.map(([name, icon], index) => `<button${index === 0 ? " data-admin=\"true\"" : ""} class=\"pos-function-button${index === 6 ? " pos-function-primary" : ""}\" type=\"button\">${icon}<span>${name}</span></button>`).join("");
  const legacyBottomButtons = [["관리", "data-admin=\"true\""], ["판매", "data-sales=\"true\""], ["영수증", "data-receipt=\"true\""], ["인원", "data-person=\"true\""], ["할인", "disabled"], ["테이블관리", "data-table-management=\"true\""]];
  bar.innerHTML = legacyBottomButtons.map(([name, attributes]) => `<button ${attributes} class="pos-function-button" type="button"><span>${name}</span></button>`).join("");
  const openAdmin = () => router.push("/pos/admin");
  const openSales = () => router.push("/pos/sales");
  const openTableManagement = () => router.push("/pos/table-management");
  const openPersonModal = () => { if (!selected?.sessionId) return; setPersonError(""); setPersonModal(true); };
  const personButton = bar.querySelector("[data-person]") as HTMLButtonElement | null;
  const receiptButton = bar.querySelector("[data-receipt]") as HTMLButtonElement | null;
  if (personButton) personButton.disabled = !selected?.sessionId;
  if (receiptButton) receiptButton.disabled = receiptPrinting;
  bar.querySelector("[data-admin]")?.addEventListener("click", openAdmin);
  bar.querySelector("[data-sales]")?.addEventListener("click", openSales);
  receiptButton?.addEventListener("click", printSelectedReceipt);
  bar.querySelector("[data-table-management]")?.addEventListener("click", openTableManagement);
  personButton?.addEventListener("click", openPersonModal);
  return () => { bar.querySelector("[data-admin]")?.removeEventListener("click", openAdmin); bar.querySelector("[data-sales]")?.removeEventListener("click", openSales); receiptButton?.removeEventListener("click", printSelectedReceipt); bar.querySelector("[data-table-management]")?.removeEventListener("click", openTableManagement); personButton?.removeEventListener("click", openPersonModal); };
 }, [router, selected?.sessionId, receiptPrinting, printSelectedReceipt]);
 useEffect(() => {
  if (!legacyMenuRendering) return;
  const menuPanel = document.querySelector("main.h-dvh > div > section:nth-child(3)") as HTMLElement | null;
  const list = menuPanel?.querySelector(":scope > div:first-child") as HTMLDivElement | null;
  if (!menuPanel || !list) return;
  const escape = (value: string) => value.replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
  const formatMoney = (value: string) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Number(value));
  const categoryBar = document.createElement("div");
  categoryBar.className = "horizontal-select-scroll pos-category-bar";
  categoryBar.innerHTML = categories.map((category, index) => `<button class=\"pos-category-button${index === 0 ? " is-active" : ""}\" data-category=\"${category.categoryId}\" type=\"button\">${escape(category.name)}</button>`).join("");
  menuPanel.classList.add("pos-right-menu-panel");
  menuPanel.insertBefore(categoryBar, list);
  const seenCategories = new Set<number | null>();
  const renderCard = (menu: Menu) => { const start = !seenCategories.has(menu.categoryId); seenCategories.add(menu.categoryId); const displayName = escape(menu.name); const imageUrl = menu.imageUrl || "/images/menu/no-image.png"; return `<button class=\"pos-menu-card\" data-menu-id=\"${menu.menuId}\" data-category=\"${menu.categoryId ?? "uncategorized"}\"${start ? " data-category-start=\"true\"" : ""} type=\"button\" aria-label=\"${escape(menu.name)} 상세\"><div class=\"pos-menu-copy\"><strong>${displayName}</strong><span class=\"pos-menu-price\">${formatMoney(menu.price)}</span></div><div class=\"pos-menu-image\"><img src=\"${escape(imageUrl)}\" alt=\"\" onerror=\"this.onerror=null;this.src='/images/menu/no-image.png'\"></div></button>`; };
  list.className = "pos-menu-list";
  list.style.display = "grid";
  list.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
  list.style.gridAutoFlow = "row";
  list.innerHTML = menus.map(renderCard).join("");
  const categoryStarts = () => [...list.querySelectorAll(".pos-menu-card[data-category-start=\"true\"]")] as HTMLElement[];
  const relativeTop = (element: HTMLElement) => element.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
  const ensureCategoryScrollRoom = () => {
   list.style.paddingBottom = "0px";
   const requiredPadding = categoryStarts().reduce((largest, card) => Math.max(largest, relativeTop(card) - (list.scrollHeight - list.clientHeight)), 0);
   list.style.paddingBottom = `${Math.max(0, Math.ceil(requiredPadding))}px`;
  };
  const setActive = (id: string) => categoryBar.querySelectorAll("button").forEach(button => button.classList.toggle("is-active", button.dataset.category === id));
  const scrollToCategory = (id: string) => { const target = list.querySelector(`.pos-menu-card[data-category=\"${id}\"][data-category-start=\"true\"]`) as HTMLElement | null; if (!target) return; list.scrollTo({ top: relativeTop(target), behavior: "smooth" }); };
  const onClick = (event: Event) => { const button = (event.target as HTMLElement).closest("button[data-category]") as HTMLButtonElement | null; if (!button) return; const id = button.dataset.category ?? "all"; setActive(id); scrollToCategory(id); };
  const onMenuClick = (event: Event) => { const card = (event.target as HTMLElement).closest("button[data-menu-id]") as HTMLButtonElement | null; if (!card) return; const menu = menus.find(item => item.menuId === Number(card.dataset.menuId)); if (menu) setQuantityMenu(menu); };
  const onScroll = () => { const current = categoryStarts().filter(card => relativeTop(card) <= list.scrollTop + 1).at(-1) ?? categoryStarts()[0]; if (current?.dataset.category) setActive(current.dataset.category); };
  categoryBar.addEventListener("click", onClick); list.addEventListener("click", onMenuClick); list.addEventListener("scroll", onScroll, { passive: true });
  const resizeObserver = new ResizeObserver(ensureCategoryScrollRoom); resizeObserver.observe(list); requestAnimationFrame(() => { ensureCategoryScrollRoom(); onScroll(); });
  return () => { resizeObserver.disconnect(); categoryBar.removeEventListener("click", onClick); list.removeEventListener("click", onMenuClick); list.removeEventListener("scroll", onScroll); categoryBar.remove(); menuPanel.classList.remove("pos-right-menu-panel"); };
 }, [menus, categories]);
 function handleBusinessClose() { /* 영업마감 기능은 추후 연결 */ }
 const handlePosExit = useCallback(async () => {
  if (posExitBusy) return;
  setPosExitBusy(true); setExitMessage("");
  try {
   await requestPosExit();
   setPosExitConfirmOpen(false); setExitDialogOpen(false);
  } catch (error) {
   console.error("POS exit request failed", error);
   setExitMessage("POS를 종료할 수 없습니다. Device Agent 연결 상태를 확인해주세요.");
  } finally { setPosExitBusy(false); }
 }, [posExitBusy]);
 const handleSystemShutdown = useCallback(async () => {
  if (shutdownBusy) return;
  setShutdownBusy(true); setExitMessage("");
  try {
   await requestSystemShutdown();
   setShutdownConfirmOpen(false); setExitDialogOpen(false);
  } catch (error) {
   console.error("System shutdown request failed", error);
   setExitMessage("시스템을 종료할 수 없습니다. 연결 상태를 확인해주세요.");
  } finally { setShutdownBusy(false); }
 }, [shutdownBusy]);
 async function confirmFirstOrder(personCount: number, babyCount: number) {
  if (!selected || selected.sessionId || !cart.length || firstOrderBusy) return;
  setFirstOrderBusy(true); setFirstOrderError("");
  try {
   const response = await fetch("/api/table-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableId: selected.tableId, personCount, babyCount }) });
   const result = await response.json() as { success?: boolean; sessionId?: number; message?: string };
   const sessionId = Number(result.sessionId);
   if (!response.ok || !result.success || !Number.isInteger(sessionId)) { setFirstOrderError(result.message ?? "테이블 시작에 실패했습니다."); return; }
   setTableOverrides(current => ({ ...current, [selected.tableId]: { sessionId, personCount, babyCount, openedAt: new Date().toISOString() } }));
   setSelectedId(selected.tableId); setSelectionVersion(version => version + 1); setFirstOrderPersonModal(false);
   const message = await saveCartToSession(sessionId);
   if (message) { setOrderError(message); return; }
   setCart([]); setTab("summary"); router.refresh();
  } catch { setFirstOrderError("네트워크 오류가 발생했습니다."); }
  finally { setFirstOrderBusy(false); }
 }
 async function savePersonCount(personCount: number, babyCount: number) { if (!selected?.sessionId || personBusy) return; setPersonBusy(true); setPersonError(""); try { const response = await fetch(`/api/table-sessions/${selected.sessionId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personCount, babyCount }) }); const result = await response.json() as { success?: boolean; message?: string; personCount?: number; babyCount?: number }; if (!response.ok || !result.success || result.personCount === undefined || result.babyCount === undefined) { setPersonError(result.message ?? "인원 정보를 저장할 수 없습니다."); return; } setTableOverrides(current => ({ ...current, [selected.tableId]: { personCount: result.personCount, babyCount: result.babyCount } })); setPersonModal(false); } catch { setPersonError("네트워크 오류가 발생했습니다."); } finally { setPersonBusy(false); } }
 function choose(t: Table) { setSelectionVersion(version => version + 1); setSelectedId(t.tableId); setTab("summary"); setFirstOrderPersonModal(false); setDiscountModal(false); setFirstOrderError(""); }
 return <main className="h-dvh w-screen min-w-0 max-w-none overflow-hidden bg-slate-100 p-3 text-slate-900" data-pos-shell><div className="pos-main-grid grid h-full min-h-0 w-full min-w-0 grid-cols-[minmax(280px,3fr)_minmax(350px,4fr)_minmax(280px,3fr)] grid-rows-[minmax(0,1fr)_auto] gap-3">
  <div className="flex min-h-0 flex-col gap-3"><section className="shrink-0 rounded-2xl bg-white p-4 shadow-sm"><header><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold tracking-[.18em] text-blue-600">TDK POS</p><div className="flex items-center gap-4"><button onClick={handleBusinessClose} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-500" type="button">{text.businessClose}</button><button onClick={() => { setExitMessage(""); setExitDialogOpen(true); }} className="rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-500" type="button">{text.exit}</button></div></div><h1 className="mt-1 text-xl font-bold">{text.store}</h1><div className="mt-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{staffName} · {staffRole}</span><LogoutButton /></div><time className="text-xs text-slate-500">{new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date())}</time></div></header></section>
  <OrderSummaryPanel selected={selected} items={items} total={displayTotal} cart={cart} cartTotal={cartTotal} tab={tab} setTab={setTab} submitCart={submitCart} clearCart={() => { setCart([]); setOrderError(""); setTab("summary"); }} adjustCartItem={adjustCartItem} adjustCartComponent={adjustCartComponent} submitting={submittingOrder} submitError={orderError} orderDetails={orderDetails} workspaceResetVersion={menuResetVersion} selectionVersion={selectionVersion} onBlockingUiChange={setOrderSummaryBlockingUiOpen} onCancellationSuccess={() => router.refresh()} onPaymentCompleted={handlePaymentCompleted} onCashPaymentRegistered={() => void handleOpenCashDrawer()} party={selectedParty} physicalSessionIds={selectedPhysicalSessionIds} discounts={discounts} /></div>
  <section className="grid min-h-0 grid-rows-[10%_60%_30%] rounded-2xl bg-white shadow-sm" data-pos-middle-panel><div className="flex min-h-0 flex-col justify-center px-4" data-pos-top-tabs><div className="grid w-full grid-cols-4 gap-2">{([ ["tables", `테이블(${openTableCount})`], ["takeout", "포장(0)"], ["reservation", "예약(0)"], ["waiting", "대기자(0)"] ] as const).map(([key, name]) => <button key={key} onClick={() => changeWorkTab(key)} className={`relative overflow-hidden whitespace-nowrap rounded-xl px-1 py-3 text-sm font-bold ${view === key ? `${viewTabStyles[key].activeClass} text-white` : "bg-slate-100 text-slate-600"}`} type="button"><span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 size-3 brightness-75 [clip-path:polygon(0_0,100%_0,0_100%)]" style={{ backgroundColor: viewTabStyles[key].color }} />{name}</button>)}</div><div aria-hidden="true" className={`mt-1.5 h-[3px] w-full rounded-full ${viewTabStyles[view].activeClass}`} /></div>{view === "tables" ? <><TableLayoutCanvas className="justify-self-center rounded-2xl border border-dashed border-slate-300 bg-slate-50" debugName="pos-table-area" style={{ width: "calc(100% - 2rem)", overflow: "visible" }}>{displayTables.map(t => <TableVisual key={t.tableId} selectedGroupId={selectedGroupId} table={t} tables={displayTables} selected={t.tableId === selectedId} choose={() => choose(t)} />)}</TableLayoutCanvas><div className="min-h-0 px-4 pb-4 pt-1.5"><RequestMessagePanel /></div></> : <><p className="flex min-h-0 items-center justify-center px-4 text-sm text-slate-400">준비 중입니다.</p><div aria-hidden="true" className="min-h-0" /></>}</section>
  <PosMenuPanel canOrderMenu={canOrderMenu} categories={categories} menus={menus} openQuantityModal={openQuantityModal} quickAddToCart={quickAddToCart} resetVersion={menuResetVersion} />
  <PosFooterBar><button aria-label="공기밥 현재수량 및 수량 조절" data-digits={String(riceCurrentQty ?? 0).length} className="rice-stock-count h-[72px] rounded-xl bg-slate-100 text-slate-800 transition hover:bg-slate-200 disabled:opacity-50" disabled={riceCurrentQty === null} onClick={() => setRiceStockModal(true)} type="button">{riceCurrentQty ?? ""}</button><button aria-label="판매내역" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200" onClick={() => router.push("/pos/sales")} type="button">판매</button><button aria-label="CashBox" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed" disabled={drawerOpening} onClick={() => void handleOpenCashDrawer()} type="button">{drawerOpening ? "여는 중..." : "CashBox"}</button><button aria-label="영수증" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed" disabled={receiptPrinting} onClick={() => void printSelectedReceipt()} type="button">{receiptPrinting ? "출력 중..." : "영수증"}</button><button aria-label="인원 조정" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed" disabled={!selected?.sessionId} onClick={() => { if (!selected?.sessionId) return; setPersonError(""); setPersonModal(true); }} type="button">인원</button><button aria-label="할인" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed" disabled={!selected?.sessionId || physicalAggregateTotal <= 0} onClick={() => setDiscountModal(true)} type="button">할인</button><button aria-label="테이블 관리" className="flex h-[72px] items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 active:scale-[0.99]" onClick={() => router.push("/pos/table-management")} type="button"><svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><rect height="13" rx="1" width="16" x="4" y="5" /><path d="M8 18v2M16 18v2M8 9h3M13 9h3M8 13h3M13 13h3" /></svg><span>테이블관리</span></button><button aria-label="고객관리" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200" type="button">고객관리</button><button aria-label="관리센터" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200" onClick={() => router.push("/pos/admin")} type="button">관리</button></PosFooterBar></div>{firstOrderPersonModal && selected && !selected.sessionId && <PersonCountModal key={`${selected.tableId}:${firstOrderAdultCount}`} title="인원 확인" personCount={firstOrderAdultCount} babyCount={0} busy={firstOrderBusy} error={firstOrderError} close={() => !firstOrderBusy && setFirstOrderPersonModal(false)} save={confirmFirstOrder} />}{personModal && selected?.sessionId && <PersonCountModal sessionId={selected.sessionId} personCount={selected.personCount ?? 0} babyCount={selected.babyCount ?? 0} busy={personBusy} error={personError} close={() => !personBusy && setPersonModal(false)} save={savePersonCount} />}{discountModal && selected?.sessionId && <DiscountModal sessionId={selected.sessionId} tableNo={selected.tableNo} items={items.map(item => ({ name: item.name, qty: item.qty, total: item.total }))} subtotal={physicalAggregateTotal} savedDiscounts={selectedDiscounts} close={() => setDiscountModal(false)} completed={() => { setDiscountModal(false); router.refresh(); }} />}{riceStockModal && <RiceStockModal close={() => { setRiceStockModal(false); router.refresh(); }} onAdjusted={() => router.refresh()} />}{quantityMenu && <QuantityModal key={quantityMenu.menuId} menu={quantityMenu} components={componentsForMenu(quantityMenu.menuId)} modifiers={menuModifiers.filter(modifier => modifier.menuId === quantityMenu.menuId)} close={() => setQuantityMenu(null)} add={(unitPrice, qty, options, components, isComplimentary) => { addToCart(quantityMenu, unitPrice, qty, options, components, isComplimentary); setQuantityMenu(null); }} />}{receiptNotice && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4"><section aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-2xl" role="alertdialog"><h2 className={`text-2xl font-extrabold ${receiptNotice.success ? "text-blue-700" : "text-red-600"}`}>{receiptNotice.title}</h2><p className="mt-5 whitespace-pre-line text-lg text-slate-600">{receiptNotice.message}</p><button autoFocus className="mt-7 min-h-14 w-full rounded-xl bg-blue-600 text-lg font-bold text-white" onClick={() => setReceiptNotice(null)} type="button">확인</button></section></div>}{exitDialogOpen && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => { if (!shutdownConfirmOpen && !posExitConfirmOpen) { setExitDialogOpen(false); setExitMessage(""); } }}><section aria-modal="true" className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()} role="dialog"><PosSubHeader backLabel="종료 선택 닫기" onBack={() => { setExitDialogOpen(false); setExitMessage(""); }} title="TDK-POS 종료" /><div className="p-6"><div className="flex gap-5"><button className="min-h-[72px] flex-1 rounded-xl border border-slate-300 bg-slate-50 text-lg font-extrabold text-slate-800 hover:bg-slate-100" onClick={() => { setExitMessage(""); setPosExitConfirmOpen(true); }} type="button">POS 종료</button><button className="min-h-[72px] flex-1 rounded-xl bg-[#455A64] text-lg font-extrabold text-white hover:brightness-110" onClick={() => { setExitMessage(""); setShutdownConfirmOpen(true); }} type="button">시스템 종료</button></div>{exitMessage && !shutdownConfirmOpen && <p className="mt-4 text-center text-sm font-semibold text-slate-600" role="status">{exitMessage}</p>}</div></section>{posExitConfirmOpen && <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4" onClick={() => { if (!posExitBusy) { setPosExitConfirmOpen(false); setExitMessage(""); } }}><section aria-modal="true" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()} role="alertdialog"><PosSubHeader backLabel="종료 선택으로 돌아가기" disabled={posExitBusy} onBack={() => { setPosExitConfirmOpen(false); setExitMessage(""); }} title="POS 종료" /><div className="p-6 text-center"><p className="text-lg font-bold text-slate-800">TDK-POS만 종료하시겠습니까?</p>{exitMessage && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{exitMessage}</p>}<button autoFocus className="mt-6 min-h-[60px] w-full rounded-xl bg-red-600 text-lg font-extrabold text-white disabled:cursor-wait disabled:opacity-50" disabled={posExitBusy} onClick={() => void handlePosExit()} type="button">{posExitBusy ? "종료 요청 중..." : "POS 종료"}</button></div></section></div>}{shutdownConfirmOpen && <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4" onClick={() => { if (!shutdownBusy) setShutdownConfirmOpen(false); }}><section aria-modal="true" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()} role="alertdialog"><PosSubHeader backLabel="종료 선택으로 돌아가기" disabled={shutdownBusy} onBack={() => setShutdownConfirmOpen(false)} title="시스템 종료" /><div className="p-6 text-center"><p className="text-lg font-bold text-slate-800">POS 컴퓨터를 종료하시겠습니까?</p>{exitMessage && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{exitMessage}</p>}<button autoFocus className="mt-6 min-h-[60px] w-full rounded-xl bg-red-600 text-lg font-extrabold text-white disabled:cursor-wait disabled:opacity-50" disabled={shutdownBusy} onClick={() => void handleSystemShutdown()} type="button">{shutdownBusy ? "종료 요청 중..." : "시스템 종료"}</button></div></section></div>}</div>}</main>;
}
function PosMenuPanel({ menus, categories, canOrderMenu, openQuantityModal, quickAddToCart, resetVersion }: { menus: Menu[]; categories: Category[]; canOrderMenu: boolean; openQuantityModal: (menu: Menu) => void; quickAddToCart: (menu: Menu) => void; resetVersion: number }) {
 const listRef = useRef<HTMLDivElement>(null);
 const [categorySelection, setCategorySelection] = useState(() => ({ categoryId: null as number | null, resetVersion }));
 const activeCategoryId = categorySelection.resetVersion === resetVersion ? categorySelection.categoryId : null;
 const categoryTabs = [{ categoryId: null, name: "ALL" }, ...categories];
 const { ref: categoryScrollRef, handlers: categoryScrollHandlers } = useHorizontalScroll(true, categoryTabs.map(category => category.categoryId ?? "all").join("\0"), false);
 const activeCategory = activeCategoryId === null ? categoryTabs[0] : categories.find(category => category.categoryId === activeCategoryId);
 const activeCategoryColor = activeCategoryId === null ? viewTabStyles.tables.color : categoryVisual(activeCategory?.name).color;
 const filteredMenus = activeCategoryId === null ? menus : menus.filter(menu => menu.categoryId === activeCategoryId);
 const selectCategory = (categoryId: number | null) => { setCategorySelection({ categoryId, resetVersion }); listRef.current?.scrollTo({ top: 0, behavior: "auto" }); };
 useEffect(() => { listRef.current?.scrollTo({ top: 0, behavior: "auto" }); }, [resetVersion]);
 useEffect(() => {
 const list = listRef.current;
 if (!list) return;
  const panel = list.closest<HTMLElement>(".pos-right-menu-panel");
  panel?.classList.toggle("is-order-disabled", !canOrderMenu);
  panel?.querySelectorAll<HTMLButtonElement>(".pos-category-button").forEach(button => { button.disabled = !canOrderMenu; });
  list.classList.toggle("is-order-disabled", !canOrderMenu);
  list.querySelectorAll<HTMLElement>(".pos-menu-card").forEach(card => {
   card.setAttribute("aria-disabled", String(!canOrderMenu));
   card.tabIndex = canOrderMenu ? 0 : -1;
  });
  list.querySelectorAll<HTMLButtonElement>(".pos-menu-cart-button").forEach(button => { button.disabled = !canOrderMenu; });
 }, [canOrderMenu, filteredMenus]);
 const renderMenuCard = (menu: Menu) => { const openMenu = () => openQuantityModal(menu); return <div aria-label={`${menu.name} 상세`} className="pos-menu-card" data-category={menu.categoryId ?? "uncategorized"} key={menu.menuId} onClick={openMenu} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openMenu(); } }} role="button" tabIndex={0}><div className="pos-menu-copy"><strong>{menu.name}</strong><span className="pos-menu-price">{new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Number(menu.price))}</span></div><div className="pos-menu-image"><img alt="" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = "/images/menu/no-image.png"; }} src={menu.imageUrl || "/images/menu/no-image.png"} /><button aria-label={`${menu.name} 주문예정에 1개 추가`} className="pos-menu-cart-button" onClick={event => { event.stopPropagation(); quickAddToCart(menu); }} onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} type="button"><img src="/icons/cart_plus_icon.svg" alt="" aria-hidden="true" className="pointer-events-none size-[22px]" /></button></div></div>; };
 return <section className="pos-right-menu-panel min-h-0 rounded-2xl bg-white p-4 shadow-sm"><div className={`horizontal-select-scroll pos-category-bar${categoryTabs.length === 6 ? " is-six-items" : ""}`} {...categoryScrollHandlers} ref={categoryScrollRef}>{categoryTabs.map(category => { const visual = category.categoryId === null ? { color: viewTabStyles.tables.color } : categoryVisual(category.name); const active = activeCategoryId === category.categoryId; return <button className={`pos-category-button${active ? " is-active" : ""}`} disabled={!canOrderMenu} key={category.categoryId ?? "all"} onClick={() => selectCategory(category.categoryId)} style={active ? { backgroundColor: visual.color } : undefined} type="button"><span aria-hidden="true" className="pos-category-corner-marker" style={{ backgroundColor: visual.color }} />{categoryDisplayName(category.name)}</button>; })}</div><div aria-hidden="true" className="pos-category-underline" style={{ backgroundColor: activeCategoryColor }} /><div className="pos-menu-list" ref={listRef}>{filteredMenus.map(renderMenuCard)}</div></section>;
}
function TableVisual({ table, tables, selected, selectedGroupId, choose }: { table: Table; tables: Table[]; selected: boolean; selectedGroupId: number | null; choose: () => void }) {
 const guestCount = (table.personCount ?? 0) + (table.babyCount ?? 0);
 const grouped = selectedGroupId !== null && table.groupId === selectedGroupId && !selected;
 return <TableShape {...table} fixedPosition={posMainFixedTablePosition(table)} grouped={grouped} partyRelationHighlight={grouped && !selected} partyTableNos={partyPeerTableNos(table, tables)} posMainTable guestCount={guestCount} hasOpenSession={table.sessionId !== null} sageOccupied hasQrOrder={table.hasQrOrder} qrLanguageCode={table.qrLanguageCode} onClick={choose} partyHighlight={selected && selectedGroupId !== null} selected={selected} thickSelection={selected} startedAt={table.openedAt} tableNumber={table.tableNo} />;
}
function QuantityModal({ menu, modifiers, components, close, add }: { menu: Menu; modifiers: MenuModifier[]; components: MenuComponent[]; close: () => void; add: (unitPrice: number, qty: number, options: PendingCartItem["options"], components: SelectedMenuComponent[], isComplimentary: boolean) => void }) {
 const [unitPrice, setUnitPrice] = useState(() => Number(menu.price)); const [qty, setQty] = useState(1); const [quickQty, setQuickQty] = useState<number | null>(null); const [expanded, setExpanded] = useState(false); const [buffer, setBuffer] = useState(""); const [validationMessage, setValidationMessage] = useState("");
 const [activeInputField, setActiveInputField] = useState<"price" | "qty" | null>(null);
 const addInProgressRef = useRef(false);
 const [isComplimentary, setIsComplimentary] = useState(false);
 const [componentEnabled, setComponentEnabled] = useState<Record<number, boolean>>(() => Object.fromEntries(components.map(component => [component.menuComponentId, true])) as Record<number, boolean>);
 const spiceGroup = modifiers.find(modifier => modifier.groupName === "매운맛"); const spiceOptions = modifiers.filter(modifier => modifier.modifierGroupId === spiceGroup?.modifierGroupId).sort((a, b) => a.optionSortOrder - b.optionSortOrder); const defaultSpice = spiceOptions.find(option => option.optionName === "약간매운맛") ?? spiceOptions[0]; const [selectedSpiceId, setSelectedSpiceId] = useState<number | null>(() => defaultSpice?.modifierOptionId ?? null);
 const formatMoney = (value: number) => formatPosMoney(value); const quickLabel = (value: number) => menu.countsAsPerson === 1 ? `${value}` : `${value}개`; const selectedSpice = spiceOptions.find(option => option.modifierOptionId === selectedSpiceId); const options = selectedSpice ? [{ modifierGroupId: selectedSpice.modifierGroupId, modifierOptionId: selectedSpice.modifierOptionId, optionName: selectedSpice.optionName, priceDelta: Number(selectedSpice.priceDelta), qty: 1 }] : [];
 const selectedComponentsForQty = (parentQty: number) => components.map(component => ({ menuComponentId: component.menuComponentId, qty: (componentEnabled[component.menuComponentId] ?? true) ? component.quantity * parentQty : 0 }));
 const confirmAdd = (selectedQty: number) => { if (addInProgressRef.current) return; if (!Number.isSafeInteger(selectedQty) || selectedQty < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) { setValidationMessage("수량과 금액을 확인하세요."); return; } addInProgressRef.current = true; setValidationMessage(""); try { add(unitPrice, selectedQty, options, selectedComponentsForQty(selectedQty), isComplimentary); } catch { addInProgressRef.current = false; setValidationMessage("주문 추가에 실패했습니다. 다시 시도하세요."); } };
 const addToCart = () => confirmAdd(qty);
 const chooseQuick = (value: number) => { setQty(value); setQuickQty(value); setValidationMessage(""); if (!expanded) confirmAdd(value); };
 const applyBuffer = (field: "price" | "qty") => { setActiveInputField(field); const value = Number(buffer); if (!buffer || !Number.isSafeInteger(value) || (field === "qty" && value < 1)) { setValidationMessage(field === "qty" ? "수량은 1 이상으로 입력하세요." : "금액을 입력하세요."); return; } if (field === "price") setUnitPrice(value); else { setQty(value); setQuickQty(null); } setBuffer(""); setValidationMessage(""); };
 const handleKeypad = (key: string) => { if (key === "C") { setBuffer(""); return; } if (key === "000") { setBuffer(value => value ? `${value}000` : ""); return; } setBuffer(value => `${value}${key}`.replace(/^0+(?=\d)/, "")); };
 useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [close]);
 return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4" onClick={close}>
  <section aria-labelledby="quantity-modal-title" aria-modal="true" className={`flex h-auto flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-xl transition-[width,max-width] duration-200 ease-out ${expanded ? "min-h-[28.5rem] w-full max-w-[calc(100vw-2rem)] md:max-w-2xl" : "min-h-[24.5rem] w-[520px] max-w-[calc(100vw-4rem)]"}`} data-expanded={expanded} onClick={event => event.stopPropagation()} role="dialog">
   <header className="-mx-5 -mt-5 mb-5 flex min-h-[70px] shrink-0 items-center justify-between gap-4 bg-[#455A64] px-5 py-3 text-white">
    <div className="flex min-w-0 flex-1 items-center gap-3">
     <AdminBackLink ariaLabel="메뉴 선택 닫기" onNavigate={close} size={46} title="메뉴 선택 닫기" tone="dark" />
     <h2 className="min-w-0 truncate text-left text-2xl font-extrabold" id="quantity-modal-title">{menu.name}</h2>
     <strong className="ml-2 shrink-0 whitespace-nowrap text-base font-extrabold">{formatMoney(isComplimentary ? 0 : unitPrice * qty)}</strong>
    </div>
    <button aria-label={expanded ? "간단 주문 옵션" : "상세 주문 옵션"} className="min-h-11 shrink-0 bg-transparent px-2 text-sm font-semibold text-white/75 transition-colors hover:text-white active:text-white" onClick={() => setExpanded(value => !value)} type="button">{expanded ? "간단 ‹" : "상세 ›"}</button>
   </header>
   <div className={`grid min-h-0 flex-1 ${expanded ? "grid-cols-[minmax(0,1fr)_13.5rem]" : "grid-cols-1"}`}>
    <div className={`${expanded ? "pr-4" : ""} pt-1.5`}>
     <div className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 shadow-[2px_3px_6px_rgba(15,23,42,0.08)]">
      <div className="grid w-full grid-cols-[108px_108px] justify-evenly gap-y-5">{[1,2,3,4].map(value => <button aria-pressed={quickQty === value} className="h-[84px] w-[108px] rounded-lg border border-slate-300 bg-slate-50 text-xl font-extrabold text-slate-800 shadow-none outline-none transition hover:bg-slate-100 active:bg-slate-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-0" key={value} onClick={() => chooseQuick(value)} type="button">{quickLabel(value)}</button>)}</div>
     </div>
     {spiceOptions.length > 0 && <div className="mt-4 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-[2px_3px_6px_rgba(15,23,42,0.08)]"><div className="grid grid-cols-4 gap-1.5">{spiceOptions.map((option, index) => <button className={`min-h-[52px] whitespace-nowrap rounded-lg px-2 text-[11px] font-bold ${selectedSpiceId === option.modifierOptionId ? "border border-red-600 bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`} key={option.modifierOptionId} onClick={() => setSelectedSpiceId(option.modifierOptionId)} type="button">{index} {option.optionName}</button>)}</div></div>}
     <div className="mt-4 grid w-full grid-cols-2 rounded-xl border border-slate-200 bg-white p-3 shadow-[2px_3px_6px_rgba(15,23,42,0.08)]">
      <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_60px_minmax(0,1fr)] items-center gap-2 px-4">
       <span className="truncate text-right text-sm font-semibold text-slate-800">무료</span>
       <button aria-checked={isComplimentary} aria-label="무료제공" className={`min-h-10 min-w-[60px] shrink-0 rounded-full px-2 text-xs font-extrabold shadow-none outline-none transition focus-visible:outline-none focus-visible:ring-0 ${isComplimentary ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"}`} onClick={() => setIsComplimentary(value => !value)} role="switch" type="button">{isComplimentary ? "ON" : "OFF"}</button>
       <span className="whitespace-nowrap text-left text-xs font-semibold text-slate-500">{isComplimentary ? "제공" : "미제공"}</span>
      </div>
      <div className="min-w-0 space-y-1 border-l border-slate-200 px-2">
       <div className="translate-x-5 space-y-1">
        {components.map(component => { const enabled = componentEnabled[component.menuComponentId] ?? true; return <div className="grid min-h-11 grid-cols-[max-content_60px_max-content] items-center justify-start gap-1" key={component.menuComponentId}><span className="whitespace-nowrap text-right text-sm font-semibold text-slate-800">{component.itemName}</span><button aria-checked={enabled} aria-label={`${component.itemName} 제공`} className={`min-h-10 min-w-[60px] rounded-full px-2 text-xs font-extrabold shadow-none outline-none transition focus-visible:outline-none focus-visible:ring-0 ${enabled ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"}`} onClick={() => setComponentEnabled(current => ({ ...current, [component.menuComponentId]: !enabled }))} role="switch" type="button">{enabled ? "ON" : "OFF"}</button><span className="whitespace-nowrap text-left text-xs font-semibold text-slate-500">{enabled ? "제공" : "미제공"}</span></div>; })}
       </div>
      </div>
     </div>
    </div>
    {expanded && <aside className="space-y-3 border-l border-slate-300 px-4">
     <section aria-label="숫자 입력 키패드" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <p className="min-h-11 border-b border-slate-200 bg-slate-50 px-3 py-2 text-right text-lg font-extrabold text-slate-800">{buffer ? new Intl.NumberFormat("ko-KR").format(Number(buffer)) : "0"}</p>
      <div className="grid grid-cols-3 gap-1.5 p-2">{["1","2","3","4","5","6","7","8","9","000","0","C"].map(key => <button className="min-h-10 rounded-lg bg-slate-100 text-base font-bold active:scale-[0.98]" key={key} onClick={() => handleKeypad(key)} type="button">{key}</button>)}</div>
     </section>
     <section aria-label="단가" className="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <button aria-pressed={activeInputField === "price"} className={`min-h-10 rounded-lg border px-3 text-sm font-bold transition ${activeInputField === "price" ? "border-blue-600 bg-blue-600 text-white" : "border-blue-300 bg-white text-blue-700"}`} onClick={() => applyBuffer("price")} type="button">단가</button>
      <strong className="whitespace-nowrap text-xl font-bold text-slate-800">{formatMoney(unitPrice)}</strong>
     </section>
     <section aria-label="수량" className="flex min-h-14 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <button aria-pressed={activeInputField === "qty"} className={`min-h-10 rounded-lg border px-3 text-sm font-bold transition ${activeInputField === "qty" ? "border-blue-600 bg-blue-600 text-white" : "border-blue-300 bg-white text-blue-700"}`} onClick={() => applyBuffer("qty")} type="button">수량</button>
      <strong className="whitespace-nowrap text-xl font-bold text-slate-800">{qty}개</strong>
     </section>
    </aside>}
   </div>
   {validationMessage && <p className="mt-3 text-sm font-medium text-red-600">{validationMessage}</p>}
   {expanded && <footer className="mt-3 border-t border-slate-200 pt-3"><button className="min-h-12 w-full rounded-xl bg-blue-600 text-base font-bold text-white active:scale-[0.99]" onClick={addToCart} type="button">추가</button></footer>}
  </section>
 </div>;

}
