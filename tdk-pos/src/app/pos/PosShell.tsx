"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMoney as formatPosMoney } from "@/lib/format-money";
import { initialAdultCountFromStewOrder } from "@/lib/initial-table-person-count";
import { buildOrderSummaryRows } from "@/lib/pos-order-summary-rows";
import { partyPeerTableNos } from "@/lib/pos-party-peers";
import { formatSessionElapsed } from "@/lib/session-time";
import { getMenuChoice } from "@/lib/menu-choice-selection";
import { inheritedTableSpicyChoice, spicyChoiceKey, synchronizePendingPotSpiciness } from "@/lib/pos-pot-spiciness";
import { openCashDrawer } from "@/lib/cash-drawer";
import { printReceipt } from "@/lib/receipt-print";
import { requestSystemShutdown } from "@/lib/system-shutdown";
import { requestPosExit } from "@/lib/pos-exit";
import LogoutButton from "./LogoutButton";
import TableShape from "./TableShape";
import TableLayoutRenderer from "./TableLayoutRenderer";
import OrderSummaryPanel, { pendingCartItemKey, type PendingCartComponent, type PendingCartItem } from "./OrderSummaryPanel";
import RequestMessagePanel from "./RequestMessagePanel";
import PersonCountModal from "./PersonCountModal";
import DiscountModal from "./DiscountModal";
import RiceStockModal from "./RiceStockModal";
import OpeningFundModal from "./OpeningFundModal";
import { BusinessClosingDialog } from "./BusinessSessionDialogs";
import PosSubHeader from "./PosSubHeader";
import PosFooterBar from "./PosFooterBar";
import TakeoutPanel, { type TakeoutSession } from "./TakeoutPanel";
import { useHorizontalScroll } from "@/hooks/useHorizontalScroll";
import { posMainFixedTablePosition } from "@/lib/table-layout";
import { sumTableFinancials, type TableFinancials } from "@/lib/table-session-financials";
import { OPENING_FUND_PROMPT_DISMISSED_KEY, shouldPromptForOpeningFund } from "@/lib/opening-fund-prompt";
type Table = { tableId: number; tableNo: string; tableName: string | null; capacity: number; positionX: number; positionY: number; layoutWidth: number; layoutHeight: number; rotation: number; amountDue: number; prepaidAmount: number; paymentTotal: number; sessionId: number | null; groupId: number | null; personCount: number | null; babyCount: number | null; openedAt: string | null; mergedSourceTableNos: string[]; mergedSourceSessionIds: number[]; hasQrOrder?: boolean; qrLanguageCode?: string | null; customerName?: string | null; sessionKind?: "DINE_IN" | "TAKEOUT_WALK_IN" | "TAKEOUT_PHONE"; pickupAt?: string | null; pickupPhone?: string | null; pickupCustomerId?: number | null; pickupCustomerName?: string | null };
type Menu = { menuId: number; categoryId: number | null; menuNumber: number | null; name: string; price: string; categoryName: string | null; imageUrl: string | null; kdsKind: "NONE" | "POT" | "ADDON" | "SOLO"; kdsGroupKey: string | null };
type MenuComponent = { menuComponentId: number; menuId: number; componentMenuId: number; itemName: string; price: string; quantity: number; printOnKitchen: number; printOnReceipt: number; sortOrder: number };
type SelectedMenuComponent = { menuComponentId: number; qty: number };
type Category = { categoryId: number; name: string };
type MenuModifier = { menuId: number; modifierGroupId: number; groupName: string; groupSortOrder: number; modifierOptionId: number; optionName: string; priceDelta: string; optionSortOrder: number; choiceDefaultOptionId: number | null };
type MenuCatalog = { menus: Menu[]; categories: Category[]; modifiers: MenuModifier[]; components: MenuComponent[] };
type MenuCatalogResponse = { success: boolean; changed?: boolean; version?: string; message?: string } & Partial<MenuCatalog>;
type Order = { sessionId: number; orderId: number; orderedAt: Date; status: string };
type OrderItem = { orderItemId: number; orderId: number; menuId: number; parentOrderItemId: number | null; itemName: string; qty: number; unitPrice: string; discountAmount: string; totalAmount: string; status: string; itemType: "NORMAL" | "COMPONENT" | "SERVICE" };
type OrderDetail = { orderId: number; sessionId: number; orderedAt: string; status: string; items: Array<OrderItem & { cancelledQty: number; effectiveQty: number; options: Array<{ orderItemId: number; modifierOptionId: number | null; optionName: string; qty: number; unitPrice: string }>; cancellations: Array<{ cancellationId: number; orderItemId: number; cancelledQty: number; cancelledAmount: string; cancellationReason: string; cancelledAt: string; cancelledByStaffId: number }> }> };
type SessionDiscount = { sessionId: number; discountType: "SNS_REVIEW" | "AMOUNT" | "PERCENT"; label: string; discountAmount: string; discountRate: number | null };
type SessionFinancial = TableFinancials & { sessionId: number };
type QuickDiscount = { ruleId: number; slot: number; title: string; type: "AMOUNT" | "PERCENT"; value: number };
const text = { store: "탑동김치찌개", exit: "종료", order: "주문합계", detail: "주문상세", table: "테이블별", kitchen: "주방" };
// Keep the shared table scene unchanged; transfer 10% of the POS canvas row to messages.
const POS_TABLE_GRID_ROWS = "10% minmax(0, calc((90% - max(140px, 18%)) * 0.9)) minmax(140px, 1fr)";
const POS_TOP_CONTROL_CLASS_NAME = "inline-flex min-h-[30px] items-center justify-center rounded-md border border-slate-200 bg-transparent px-2 py-1.5 text-xs leading-4 text-slate-500 transition-colors hover:bg-slate-50 active:bg-slate-100";
const viewTabStyles = {
 tables: { activeClass: "bg-[#2563EB]", color: "#2563EB" },
 takeout: { activeClass: "bg-[#16A34A]", color: "#16A34A" },
 reservation: { activeClass: "bg-[#7C3AED]", color: "#7C3AED" },
 waiting: { activeClass: "bg-[#EA580C]", color: "#EA580C" },
} as const;
const categoryVisuals: Record<string, { color: string }> = {
 "김치찌개": { color: "#DC2626" },
 "사이드": { color: "#16A34A" },
 "주류·음료": { color: "#EA580C" },
 "추가": { color: "#0891B2" },
 "포장": { color: "#7C3AED" },
};
const categoryVisual = (name: string | null | undefined) => categoryVisuals[name ?? ""] ?? { color: "#64748B" };
const categoryDisplayName = (name: string) => ({ "김치찌개": "찌개", "사이드": "단품", "주류·음료": "음료" }[name] ?? name);
const legacyDomRendering = process.env.NEXT_PUBLIC_LEGACY_POS_DOM === "enabled";
const legacyOrderSummaryRendering = process.env.NEXT_PUBLIC_LEGACY_ORDER_SUMMARY === "enabled";
const legacyMenuRendering = process.env.NEXT_PUBLIC_LEGACY_MENU_DOM === "enabled";
const countOpenTables = (tables: Table[]) => tables.filter(table => table.sessionId !== null).length;
const physicalTableSessionIds = (table: Table): number[] => table.sessionId === null ? [] : [...new Set([table.sessionId, ...table.mergedSourceSessionIds])];
export default function PosShell({ staffName, staffRole, tables, takeouts, menus: initialMenus, menuComponents: initialMenuComponents, categories: initialCategories, menuModifiers: initialMenuModifiers, orders, orderItems, orderDetails, discounts, sessionFinancials, quickDiscounts: _quickDiscounts, idleResetSeconds, riceCurrentQty }: { staffName: string; staffRole: "OWNER" | "MANAGER" | "STAFF" | "SHARED"; tables: Table[]; takeouts: Table[]; menus: Menu[]; menuComponents: MenuComponent[]; categories: Category[]; menuModifiers: MenuModifier[]; orders: Order[]; orderItems: OrderItem[]; orderDetails: OrderDetail[]; discounts: SessionDiscount[]; sessionFinancials: SessionFinancial[]; quickDiscounts: QuickDiscount[]; idleResetSeconds: number; riceCurrentQty: number | null }) {
 void _quickDiscounts;
 const [menuCatalog, setMenuCatalog] = useState<MenuCatalog>(() => ({ menus: initialMenus, categories: initialCategories, modifiers: initialMenuModifiers, components: initialMenuComponents }));
 const [tableSpicyOverrides, setTableSpicyOverrides] = useState<Record<number, { name: string; orderItemId: number; expiresAt: number }>>({});
 const { menus, categories, modifiers: menuModifiers, components: menuComponents } = menuCatalog;
 const menuVersionRef = useRef<string | null>(null);
 const menuCheckInFlightRef = useRef(false);
 const lastMenuCheckAtRef = useRef(0);
 const [menuRefreshing, setMenuRefreshing] = useState(false);
 const [menuRefreshError, setMenuRefreshError] = useState("");
 const checkMenus = useCallback(async (manual = false) => {
  if (menuCheckInFlightRef.current || (!manual && document.visibilityState === "hidden")) return;
  if (!manual && Date.now() - lastMenuCheckAtRef.current < 1_000) return;
  menuCheckInFlightRef.current = true;
  lastMenuCheckAtRef.current = Date.now();
  setMenuRefreshing(true);
  try {
   const query = menuVersionRef.current && !manual ? `?version=${menuVersionRef.current}` : "";
   const response = await fetch(`/api/pos/menu-catalog${query}`, { cache: "no-store" });
   const result = await response.json() as MenuCatalogResponse;
   if (!response.ok || !result.success || !result.version) throw new Error(result.message ?? "메뉴 정보를 불러오지 못했습니다.");
   if (result.changed) {
    if (!result.menus || !result.categories || !result.modifiers || !result.components)
     throw new Error("메뉴 정보를 확인할 수 없습니다.");
    setMenuCatalog({ menus: result.menus, categories: result.categories, modifiers: result.modifiers, components: result.components });
   }
   menuVersionRef.current = result.version;
   setMenuRefreshError("");
  } catch (error) {
   if (manual) setMenuRefreshError(error instanceof Error ? error.message : "메뉴 새로고침에 실패했습니다.");
  } finally {
   menuCheckInFlightRef.current = false;
   setMenuRefreshing(false);
  }
 }, []);
 const [takeoutCarts, setTakeoutCarts] = useState<Record<number, PendingCartItem[]>>({});
 const [tableCarts, setTableCarts] = useState<Record<number, PendingCartItem[]>>({});
 const [businessOpening, setBusinessOpening] = useState(false);
 const [businessClosing, setBusinessClosing] = useState(false);
 const [businessCloseConfirmed, setBusinessCloseConfirmed] = useState(false);
 const openingRetry = useRef<(() => void) | null>(null);
 const openingPromptDismissed = useRef(false);
 const openingStatusRequest = useRef<Promise<{ success?: boolean; openingStatus?: { enabled: boolean; registered: boolean }; message?: string }> | null>(null);
 useEffect(() => {
  const initialCheck = window.setTimeout(() => void checkMenus(), 0);
  const onFocus = () => { void checkMenus(); };
  const onVisible = () => { if (document.visibilityState === "visible") void checkMenus(); };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  const interval = window.setInterval(() => void checkMenus(), 45_000);
  return () => {
   window.clearTimeout(initialCheck);
   window.removeEventListener("focus", onFocus);
   document.removeEventListener("visibilitychange", onVisible);
   window.clearInterval(interval);
  };
 }, [checkMenus]);
 const [quantityMenuConfig, setQuantityMenuConfig] = useState<{ components: MenuComponent[]; modifiers: MenuModifier[] } | null>(null);
 const [orderSummaryBlockingUiOpen, setOrderSummaryBlockingUiOpen] = useState(false);
 const [takeoutBlockingUiOpen, setTakeoutBlockingUiOpen] = useState(false);
 const [customerSelectOpen, setCustomerSelectOpen] = useState(false);
 const receiptPrintingRef = useRef(false);
 const drawerOpeningRef = useRef(false);
 const [drawerOpening, setDrawerOpening] = useState(false);
 const [receiptPrinting, setReceiptPrinting] = useState(false);
 const [receiptNotice, setReceiptNotice] = useState<{ title: string; message: string; success: boolean } | null>(null);
 const [exitDialogOpen, setExitDialogOpen] = useState(false);
 const [posExitBusy, setPosExitBusy] = useState(false);
 const [shutdownConfirmOpen, setShutdownConfirmOpen] = useState(false);
 const [shutdownBusy, setShutdownBusy] = useState(false);
 const shutdownRequest = useRef(false);
 const [exitMessage, setExitMessage] = useState("");

 const router = useRouter(); const searchParams = useSearchParams(); const refreshedOnTableManagementReturn = useRef(false); const [selectedId, setSelectedId] = useState<number | null>(null); const [selectionVersion, setSelectionVersion] = useState(0); const [view, setView] = useState<"tables"|"takeout"|"reservation"|"waiting">("tables"); const [tab, setTab] = useState<"summary" | "pending" | "detail" | "table" | "kitchen">("summary"); const [fullscreen, setFullscreen] = useState(false); const [personModal, setPersonModal] = useState(false); const [discountModal, setDiscountModal] = useState(false); const [riceStockModal, setRiceStockModal] = useState(false); const [openingFundModal, setOpeningFundModal] = useState(false); const [personBusy, setPersonBusy] = useState(false); const [personError, setPersonError] = useState(""); const [cart, setCart] = useState<PendingCartItem[]>([]); const [quantityMenu, setQuantityMenu] = useState<Menu | null>(null); const [submittingOrder, setSubmittingOrder] = useState(false); const [orderError, setOrderError] = useState(""); const [menuResetVersion, setMenuResetVersion] = useState(0); const [tableOverrides, setTableOverrides] = useState<Record<number, Partial<Table>>>({}); const [newTakeouts, setNewTakeouts] = useState<Table[]>([]); const [cancelledTakeoutIds, setCancelledTakeoutIds] = useState<number[]>([]); const displayTables = tables.map(table => ({ ...table, ...tableOverrides[table.tableId] })); const displayTakeouts = [...takeouts.filter(session => !cancelledTakeoutIds.includes(session.sessionId!)), ...newTakeouts.filter(session => !takeouts.some(persisted => persisted.sessionId === session.sessionId) && !cancelledTakeoutIds.includes(session.sessionId!))]; const openTableCount = countOpenTables(displayTables);
  const isOpeningPromptDismissed = () => {
  if (openingPromptDismissed.current) return true;
  try { return window.sessionStorage.getItem(OPENING_FUND_PROMPT_DISMISSED_KEY) === "1"; }
  catch { return false; }
 };
 const requireBusinessOpening = (retry: () => void) => {
  if (isOpeningPromptDismissed()) { setOrderError("오늘 준비금 등록을 취소했습니다. 준비금이 필요한 주문은 로그아웃 후 다시 로그인해 등록해 주세요."); return false; }
  openingRetry.current = retry;
  setBusinessOpening(true);
  return true;
 };
 useEffect(() => {
  if (isOpeningPromptDismissed()) return;
  let active = true;
  const request = openingStatusRequest.current ??= fetch("/api/pos/opening-fund", { cache: "no-store" }).then(async response => {
   const result = await response.json() as { success?: boolean; openingStatus?: { enabled: boolean; registered: boolean }; message?: string };
   if (!response.ok || !result.success || !result.openingStatus) throw new Error(result.message ?? "오늘 준비금 등록 여부를 확인하지 못했습니다.");
   return result;
  });
  void request.then(result => {
   if (active && shouldPromptForOpeningFund(result.openingStatus!, isOpeningPromptDismissed())) {
    openingRetry.current = null;
    setBusinessOpening(true);
   }
  }).catch(error => {
   if (active) setOrderError(error instanceof Error ? error.message : "오늘 준비금 등록 여부를 확인하지 못했습니다.");
  });
  return () => { active = false; };
 }, []);
 const refreshPosData = useCallback(() => {
  setTableOverrides({});
  setNewTakeouts([]);
  setCancelledTakeoutIds([]);
  router.refresh();
  void checkMenus(true);
 }, [checkMenus, router]);
const takeoutPanelSessions: TakeoutSession[] = displayTakeouts.flatMap(session => {
  if (session.sessionId === null || (session.sessionKind !== "TAKEOUT_WALK_IN" && session.sessionKind !== "TAKEOUT_PHONE")) return [];
  const sessionOrders = orderDetails.filter(order => order.sessionId === session.sessionId);
  const activeItems = sessionOrders.flatMap(order => order.items).filter(item => item.effectiveQty > 0 && item.itemType !== "SERVICE");
  const itemQuantities = new Map<string, { name: string; qty: number; options: Set<string>; components: Map<string, number> }>();
  sessionOrders.forEach(order => order.items.forEach(item => {
   if (item.itemType !== "NORMAL" || item.effectiveQty <= 0) return;
   const key = `${item.menuId}:${item.itemName}`;
   const summary = itemQuantities.get(key) ?? { name: item.itemName, qty: 0, options: new Set<string>(), components: new Map<string, number>() };
   summary.qty += item.effectiveQty;
   item.options.forEach(option => summary.options.add(option.optionName));
   order.items.filter(component => component.parentOrderItemId === item.orderItemId && component.itemType === "COMPONENT" && component.effectiveQty > 0).forEach(component => {
    summary.components.set(component.itemName, (summary.components.get(component.itemName) ?? 0) + component.effectiveQty);
   });
   itemQuantities.set(key, summary);
  }));
  const isDone = activeItems.length > 0 && activeItems.every(item => item.status === "READY" || item.status === "SERVED");
  const isPreparing = activeItems.some(item => item.status === "PREPARING" || item.status === "READY" || item.status === "SERVED");
  const orderCreatedAt = sessionOrders.map(order => order.orderedAt).sort()[0];
  const financials = sessionFinancials.find(financial => financial.sessionId === session.sessionId);
  return [{ sessionId: session.sessionId, tableId: session.tableId, tableNo: session.tableNo, sessionKind: session.sessionKind, openedAt: session.openedAt ?? new Date().toISOString(), pickupAt: session.pickupAt, pickupPhone: session.pickupPhone, pickupCustomerId: session.pickupCustomerId, pickupCustomerName: session.pickupCustomerName, orderCreatedAt, prepStatus: isDone ? "DONE" as const : isPreparing ? "PREPARING" as const : "ORDER_RECEIVED" as const, receivableAmount: financials?.receivable ?? 0, items: [...itemQuantities.values()].map(item => ({ name: item.name, qty: item.qty, detail: [...item.options, ...[...item.components].map(([name, qty]) => `${name} ×${qty}`)].join(", ") || undefined })) }];
 }); useEffect(() => {
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
 const selected = selectedId === null ? null : [...displayTables, ...displayTakeouts].find(t => t.tableId === selectedId) ?? null;
 const currentQuantityMenu = quantityMenu && menus.find(menu => menu.menuId === quantityMenu.menuId);
 const quantityMenuChanged = quantityMenu !== null && (!currentQuantityMenu || currentQuantityMenu.price !== quantityMenu.price || currentQuantityMenu.name !== quantityMenu.name || JSON.stringify(quantityMenuConfig) !== JSON.stringify({ components: menuComponents.filter(component => component.menuId === quantityMenu.menuId), modifiers: menuModifiers.filter(modifier => modifier.menuId === quantityMenu.menuId) }));
 const sendReceipt = useCallback(async (target: { tableId?: number; checkoutId?: number; isReprint?: boolean }) => {
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
  if (selected?.sessionKind && selected.sessionKind !== "DINE_IN") {
   setReceiptNotice({ title: "영수증 출력", message: "포장 결제완료 화면이나 판매내역에서 영수증을 출력해 주세요.", success: false });
   return;
  }
  if (view !== "tables" || !selected?.tableId) {
   setReceiptNotice({ title: "영수증 출력", message: "출력할 테이블을 먼저 선택해 주세요.", success: false });
   return;
  }
  await sendReceipt({ tableId: selected.tableId });
 }, [selected?.tableId, selected?.sessionKind, view, sendReceipt]);
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
 const canOrderMenu = view === "takeout" ? Boolean(selected) : view !== "tables" || Boolean(selected);
 const [firstOrderPersonModal, setFirstOrderPersonModal] = useState(false);
 const [firstOrderBusy, setFirstOrderBusy] = useState(false);
 const [firstOrderError, setFirstOrderError] = useState("");
 const isBlockingUiOpen = personModal || discountModal || riceStockModal || openingFundModal || businessOpening || businessClosing || firstOrderPersonModal || quantityMenu !== null || orderSummaryBlockingUiOpen || takeoutBlockingUiOpen || receiptNotice !== null;
 const selectedPhysicalSessionIds = useMemo(() => selected ? physicalTableSessionIds(selected) : [], [selected]); const items = useMemo(() => buildOrderSummaryRows(orderDetails.filter(order => selectedPhysicalSessionIds.includes(order.sessionId)).flatMap(order => order.items)), [selectedPhysicalSessionIds, orderDetails]); const physicalAggregateTotal = items.reduce((sum, item) => sum + item.total, 0); const selectedDiscounts = useMemo(() => discounts.filter(discount => selectedPhysicalSessionIds.includes(discount.sessionId)), [discounts, selectedPhysicalSessionIds]); const appliedDiscountTotal = selectedDiscounts.reduce((sum, discount) => sum + Number(discount.discountAmount), 0); const displayTotal = Math.max(0, physicalAggregateTotal - appliedDiscountTotal); const cartTotal = cart.reduce((sum, item) => sum + (item.isComplimentary ? 0 : item.unitPrice * item.qty) + (item.components ?? []).reduce((componentSum, component) => componentSum + component.unitPrice * component.qty, 0), 0);
 const componentsForMenu = (menuId: number) => menuComponents.filter(component => component.menuId === menuId);
 const firstOrderAdultCount = initialAdultCountFromStewOrder(cart, menus, categories);
 const addToCart = (menu: Menu, unitPrice: number, qty: number, options: PendingCartItem["options"] = [], selectedComponents?: SelectedMenuComponent[], isComplimentary = false) => {
  const configuredComponents = componentsForMenu(menu.menuId);
  const selectedQtyById = new Map(selectedComponents?.map(component => [component.menuComponentId, component.qty]) ?? []);
  const components: PendingCartComponent[] = configuredComponents.map(component => {
   const defaultQty = component.quantity * qty;
   const componentQty = selectedQtyById.get(component.menuComponentId) ?? defaultQty;
   return { menuComponentId: component.menuComponentId, componentMenuId: component.componentMenuId, itemName: component.itemName, perMenuQty: component.quantity, qty: componentQty, touched: componentQty !== defaultQty, unitPrice: 0 };
  });
  const pricedUnit = unitPrice + options.reduce((sum, option) => sum + option.priceDelta * option.qty, 0);
  const newItem: PendingCartItem = { menuId: menu.menuId, menuName: menu.name, unitPrice: pricedUnit, qty, options, components, isComplimentary };
  const newItemKey = pendingCartItemKey(newItem);
  setCart(current => {
   const selectedTaste = options.find(option => option.modifierGroupId === getMenuChoice(menuModifiers.filter(modifier => modifier.menuId === menu.menuId)).selected?.modifierGroupId);
   const synchronized = selectedTaste ? synchronizePendingPotSpiciness(current, menu, selectedTaste.optionName, menus, menuModifiers) : current;
   const matchingIndex = synchronized.findIndex(item => pendingCartItemKey(item) === newItemKey);
   if (matchingIndex < 0) return [...synchronized, newItem];
   return synchronized.map((item, index) => index === matchingIndex ? { ...item, qty: item.qty + qty, components: (item.components ?? []).map(component => component.touched ? component : { ...component, qty: Math.max(0, component.qty + component.perMenuQty * qty) }) } : item);
  });
  setOrderError("");
  setTab("pending");
 };
 const saveCartToSession = async (sessionId: number) => {
  try {
   const response = await fetch(`/api/table-sessions/${sessionId}/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: cart.map(item => ({ menuId: item.menuId, qty: item.qty, isComplimentary: item.isComplimentary === true, options: (item.options ?? []).map(option => ({ modifierOptionId: option.modifierOptionId, qty: option.qty })), components: (item.components ?? []).map(component => ({ menuComponentId: component.menuComponentId, qty: component.qty })) })) }) });
   const result = await response.json() as { success?: boolean; message?: string; openingRequired?: boolean };
   if (response.status === 428 && result.openingRequired) return "OPENING_REQUIRED";
   return response.ok && result.success ? null : result.message ?? "주문 저장에 실패했습니다.";
  } catch { return "주문 저장 중 네트워크 오류가 발생했습니다."; }
 };
 const submitCart = async () => {
  if (!selected || !cart.length || submittingOrder || firstOrderBusy) { if (!selected) setOrderError("주문할 테이블을 선택하세요."); return; }
  if (view === "tables" && !selected.sessionId) {
   setFirstOrderError("");
   setFirstOrderPersonModal(true);
   return;
  }
  if (!selected.sessionId) { setOrderError("주문할 사용 중 테이블을 선택하세요."); return; }
  setSubmittingOrder(true); setOrderError("");
  const message = await saveCartToSession(selected.sessionId);
  if (message === "OPENING_REQUIRED") requireBusinessOpening(() => void submitCart());
  else if (message) setOrderError(message); else { setCart([]); if (view === "takeout") setTakeoutCarts(current => ({ ...current, [selected.sessionId!]: [] })); else setTableCarts(current => { const next = { ...current }; delete next[selected.tableId]; return next; }); setTab("summary"); router.refresh(); }
  setSubmittingOrder(false);
 };
 const tableSpicyChoice = (menu: Menu) => {
  if (menu.kdsKind !== "POT") return null;
  const override = selected?.sessionId ? tableSpicyOverrides[selected.sessionId] : undefined;
  const choices = getMenuChoice(menuModifiers.filter(modifier => modifier.menuId === menu.menuId)).options;
  if (override) {
   const savedItem = orderDetails.filter(order => order.sessionId === selected?.sessionId)
    .flatMap(order => order.items).find(item => item.orderItemId === override.orderItemId);
   const sourceOptions = savedItem ? getMenuChoice(menuModifiers.filter(modifier =>
    modifier.menuId === savedItem.menuId)).options : [];
   const sourceChoice = savedItem?.options.find(option =>
    sourceOptions.some(choice => choice.modifierOptionId === option.modifierOptionId));
   const currentName = Date.now() < override.expiresAt ? override.name : sourceChoice?.optionName ?? override.name;
   const matched = choices.find(choice => spicyChoiceKey(choice.optionName) === spicyChoiceKey(currentName));
   if (matched) return matched;
  }
  const saved = selected?.sessionId ? orderDetails.filter(order => order.sessionId === selected.sessionId)
   .slice().reverse().flatMap(order => order.items.slice().reverse().filter(item => item.status !== "CANCELLED")) : [];
  return inheritedTableSpicyChoice(menu, [...cart.slice().reverse(), ...saved], menus, menuModifiers);
 };
 const defaultCartOptions = (menu: Menu): PendingCartItem["options"] => {
  const { selected: defaultChoice } = getMenuChoice(menuModifiers.filter(modifier => modifier.menuId === menu.menuId));
  const selected = tableSpicyChoice(menu) ?? defaultChoice;
  return selected ? [{ modifierGroupId: selected.modifierGroupId, modifierOptionId: selected.modifierOptionId, optionName: selected.optionName, priceDelta: Number(selected.priceDelta), qty: 1 }] : [];
 };
 const quickAddToCart = (menu: Menu) => { if (!canOrderMenu) return; addToCart(menu, Number(menu.price), 1, defaultCartOptions(menu)); };
 const openQuantityModal = (menu: Menu) => { if (canOrderMenu) { setQuantityMenuConfig({ components: componentsForMenu(menu.menuId), modifiers: menuModifiers.filter(modifier => modifier.menuId === menu.menuId) }); setQuantityMenu(menu); } };
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
 const resetPosWorkspace = useCallback(() => { setSelectedId(null); setSelectionVersion(version => version + 1); setFirstOrderPersonModal(false); setFirstOrderBusy(false); setFirstOrderError(""); setCart([]); setTableCarts({}); setQuantityMenu(null); setDiscountModal(false); setOrderError(""); setTab("summary"); setMenuResetVersion(version => version + 1); }, []);
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
  if (selected?.sessionKind && selected.sessionKind !== "DINE_IN" && selected.sessionId) {
   setCancelledTakeoutIds(current => [...current, selected.sessionId!]);
   setNewTakeouts(current => current.filter(session => session.sessionId !== selected.sessionId));
   setTakeoutCarts(current => { const next = { ...current }; delete next[selected.sessionId!]; return next; });
  }
  setTableOverrides({});
  resetPosWorkspace();
  router.refresh();
 }, [resetPosWorkspace, router, selected]);
 const changeWorkTab = (nextView: typeof view) => { if (nextView === view) return; if (view === "takeout" && selected?.sessionId) setTakeoutCarts(current => ({ ...current, [selected.sessionId!]: cart })); resetPosWorkspace(); setView(nextView); };
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
   ["CashBox", svg("<path d=\"M3 8h18v11H3z\"/><path d=\"M6 8V5h12v3M7 13h4\"/><circle cx=\"17\" cy=\"14\" r=\"1\"/>")],
   ["청구서", svg("<path d=\"M6 3h9l3 3v15H6z\"/><path d=\"M15 3v4h4M9 12h6M9 16h6\"/>")],
   ["영수증", svg("<path d=\"M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z\"/><path d=\"M9 8h6M9 12h6M9 16h4\"/>")],
   ["테이블정보", svg("<rect x=\"4\" y=\"5\" width=\"16\" height=\"11\" rx=\"1\"/><path d=\"M8 16v3M16 16v3M10 9h4M12 7v4\"/>")],
   ["할인", svg("<circle cx=\"7\" cy=\"7\" r=\"2\"/><circle cx=\"17\" cy=\"17\" r=\"2\"/><path d=\"m6 18 12-12\"/>")],
   ["계산", svg("<rect x=\"5\" y=\"3\" width=\"14\" height=\"18\" rx=\"2\"/><path d=\"M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01\"/>")],
  ];
  bar.className = "col-span-2 pos-function-bar";
  bar.innerHTML = buttons.map(([name, icon], index) => `<button class=\"pos-function-button${index === 5 ? " pos-function-primary" : ""}\" type=\"button\">${icon}<span>${name}</span></button>`).join("");
  const legacyBottomButtons = [["판매", "data-sales=\"true\""], ["영수증", "data-receipt=\"true\""], ["인원", "data-person=\"true\""], ["할인", "disabled"], ["테이블관리", "data-table-management=\"true\""]];
  bar.innerHTML = legacyBottomButtons.map(([name, attributes]) => `<button ${attributes} class="pos-function-button" type="button"><span>${name}</span></button>`).join("");
  const openSales = () => router.push("/pos/sales");
  const openTableManagement = () => router.push("/pos/table-management");
  const openPersonModal = () => { if (!selected?.sessionId) return; setPersonError(""); setPersonModal(true); };
  const personButton = bar.querySelector("[data-person]") as HTMLButtonElement | null;
  const receiptButton = bar.querySelector("[data-receipt]") as HTMLButtonElement | null;
  if (personButton) personButton.disabled = !selected?.sessionId;
  if (receiptButton) receiptButton.disabled = receiptPrinting;
  bar.querySelector("[data-sales]")?.addEventListener("click", openSales);
  receiptButton?.addEventListener("click", printSelectedReceipt);
  bar.querySelector("[data-table-management]")?.addEventListener("click", openTableManagement);
  personButton?.addEventListener("click", openPersonModal);
  return () => { bar.querySelector("[data-sales]")?.removeEventListener("click", openSales); receiptButton?.removeEventListener("click", printSelectedReceipt); bar.querySelector("[data-table-management]")?.removeEventListener("click", openTableManagement); personButton?.removeEventListener("click", openPersonModal); };
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
  const renderCard = (menu: Menu) => { const start = !seenCategories.has(menu.categoryId); seenCategories.add(menu.categoryId); const displayName = escape(menu.name); const menuNumber = menu.menuNumber === null ? "" : `<span aria-hidden=\"true\" class=\"pos-menu-number\">${menu.menuNumber}</span>`; return `<button class=\"pos-menu-card\" style=\"--pos-menu-accent:${escape(categoryVisual(menu.categoryName).color)}\" data-menu-id=\"${menu.menuId}\" data-category=\"${menu.categoryId ?? "uncategorized"}\"${start ? " data-category-start=\"true\"" : ""} type=\"button\" aria-label=\"${escape(menu.name)} 상세\">${menuNumber}<div class=\"pos-menu-copy\"><strong>${displayName}</strong><span class=\"pos-menu-price\">${formatMoney(menu.price)}</span></div></button>`; };
  list.className = "pos-menu-list";
  list.style.display = "grid";
  list.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
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
  const onMenuClick = (event: Event) => { const card = (event.target as HTMLElement).closest("button[data-menu-id]") as HTMLButtonElement | null; if (!card) return; const menu = menus.find(item => item.menuId === Number(card.dataset.menuId)); if (menu) { setQuantityMenuConfig({ components: menuComponents.filter(component => component.menuId === menu.menuId), modifiers: menuModifiers.filter(modifier => modifier.menuId === menu.menuId) }); setQuantityMenu(menu); } };
  const onScroll = () => { const current = categoryStarts().filter(card => relativeTop(card) <= list.scrollTop + 1).at(-1) ?? categoryStarts()[0]; if (current?.dataset.category) setActive(current.dataset.category); };
  categoryBar.addEventListener("click", onClick); list.addEventListener("click", onMenuClick); list.addEventListener("scroll", onScroll, { passive: true });
  const resizeObserver = new ResizeObserver(ensureCategoryScrollRoom); resizeObserver.observe(list); requestAnimationFrame(() => { ensureCategoryScrollRoom(); onScroll(); });
  return () => { resizeObserver.disconnect(); categoryBar.removeEventListener("click", onClick); list.removeEventListener("click", onMenuClick); list.removeEventListener("scroll", onScroll); categoryBar.remove(); menuPanel.classList.remove("pos-right-menu-panel"); };
 }, [menus, categories, menuComponents, menuModifiers]);
 const handleFullscreen = async () => {
  try {
   if (document.fullscreenElement) await document.exitFullscreen();
   else await document.documentElement.requestFullscreen();
  } catch (error) {
   console.warn("POS fullscreen change failed", error);
   setReceiptNotice({ title: "전체화면 전환 실패", message: "전체화면으로 전환하지 못했습니다. 다시 시도해 주세요.", success: false });
  }
 };
 const handlePosExit = useCallback(async () => {
  if (posExitBusy) return;
  setPosExitBusy(true); setExitMessage("");
  try {
   await requestPosExit();
   setExitDialogOpen(false);
  } catch (error) {
   console.error("POS exit request failed", error);
   setExitMessage("POS를 종료할 수 없습니다. Device Agent 연결 상태를 확인해주세요.");
  } finally { setPosExitBusy(false); }
 }, [posExitBusy]);
 const handleSystemShutdown = useCallback(async () => {
  if (shutdownRequest.current) return;
  shutdownRequest.current = true;
  setShutdownBusy(true); setExitMessage("");
  let accepted = false;
  try {
   await requestSystemShutdown();
   accepted = true;
   setShutdownConfirmOpen(false); setExitDialogOpen(false);
  } catch (error) {
   console.error("System shutdown request failed", error);
   setExitMessage("시스템을 종료하지 못했습니다.");
  } finally {
   if (!accepted) shutdownRequest.current = false;
   setShutdownBusy(false);
  }
 }, []);
 async function confirmFirstOrder(personCount: number, babyCount: number) {
  if (!selected || selected.sessionId || !cart.length || firstOrderBusy) return;
  setFirstOrderBusy(true); setFirstOrderError("");
  try {
   const response = await fetch("/api/table-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableId: selected.tableId, personCount, babyCount }) });
   const result = await response.json() as { success?: boolean; sessionId?: number; message?: string; openingRequired?: boolean };
   if (response.status === 428 && result.openingRequired) {
    const promptShown = requireBusinessOpening(() => void confirmFirstOrder(personCount, babyCount));
    if (promptShown === false) setFirstOrderError("오늘 준비금 등록을 취소했습니다. 준비금이 필요한 주문은 로그아웃 후 다시 로그인해 등록해 주세요.");
    return;
   }
   const sessionId = Number(result.sessionId);
   if (!response.ok || !result.success || !Number.isInteger(sessionId)) { setFirstOrderError(result.message ?? "테이블 시작에 실패했습니다."); return; }
   setTableOverrides(current => ({ ...current, [selected.tableId]: { sessionId, personCount, babyCount, openedAt: new Date().toISOString() } }));
   setSelectedId(selected.tableId); setSelectionVersion(version => version + 1); setFirstOrderPersonModal(false);
   const message = await saveCartToSession(sessionId);
   if (message === "OPENING_REQUIRED") { requireBusinessOpening(() => router.refresh()); setOrderError("준비금 등록 후 주문을 다시 눌러주세요."); return; }
   if (message) { setOrderError(message); return; }
   setCart([]); setTableCarts(current => { const next = { ...current }; delete next[selected.tableId]; return next; }); setTab("summary"); router.refresh();
  } catch { setFirstOrderError("네트워크 오류가 발생했습니다."); }
  finally { setFirstOrderBusy(false); }
 }
 async function savePersonCount(personCount: number, babyCount: number) { if (!selected?.sessionId || personBusy) return; setPersonBusy(true); setPersonError(""); try { const response = await fetch(`/api/table-sessions/${selected.sessionId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personCount, babyCount }) }); const result = await response.json() as { success?: boolean; message?: string; personCount?: number; babyCount?: number }; if (!response.ok || !result.success || result.personCount === undefined || result.babyCount === undefined) { setPersonError(result.message ?? "인원 정보를 저장할 수 없습니다."); return; } setTableOverrides(current => ({ ...current, [selected.tableId]: { personCount: result.personCount, babyCount: result.babyCount } })); setPersonModal(false); } catch { setPersonError("네트워크 오류가 발생했습니다."); } finally { setPersonBusy(false); } }
 function choose(t: Table) { if (selectedId !== t.tableId) { if (selectedId !== null) setTableCarts(current => ({ ...current, [selectedId]: cart })); setCart(tableCarts[t.tableId] ?? []); } setMenuResetVersion(version => version + 1); setSelectionVersion(version => version + 1); setSelectedId(t.tableId); setTab("summary"); setFirstOrderPersonModal(false); setDiscountModal(false); setFirstOrderError(""); }
 function selectTakeout(session: TakeoutSession) {
  if (selected?.sessionKind && selected.sessionKind !== "DINE_IN" && selected.sessionId) setTakeoutCarts(current => ({ ...current, [selected.sessionId!]: cart }));
  setSelectedId(session.tableId);
  setCart(takeoutCarts[session.sessionId] ?? []);
  setSelectionVersion(version => version + 1);
  setTab("summary");
  setOrderError("");
 }
 function takeoutCreated(session: TakeoutSession) {
  setNewTakeouts(current => [...current, { ...session, tableName: null, capacity: 0, positionX: 0, positionY: 0, layoutWidth: 0, layoutHeight: 0, rotation: 0, amountDue: 0, prepaidAmount: 0, paymentTotal: 0, groupId: null, personCount: 0, babyCount: 0, mergedSourceTableNos: [], mergedSourceSessionIds: [] }]);
  selectTakeout(session);
  router.refresh();
 }
 function takeoutCancelled(sessionId: number) {
  setCancelledTakeoutIds(current => [...current, sessionId]);
  setNewTakeouts(current => current.filter(session => session.sessionId !== sessionId));
  setTakeoutCarts(current => { const next = { ...current }; delete next[sessionId]; return next; });
  if (selected?.sessionId === sessionId) { setSelectedId(null); setCart([]); }
  router.refresh();
 }
 return <main className="h-dvh w-screen min-w-0 max-w-none overflow-hidden bg-slate-100 p-3 text-slate-900" data-pos-shell><div className="pos-main-grid grid h-full min-h-0 w-full min-w-0 grid-cols-[minmax(280px,3fr)_minmax(350px,4fr)_minmax(280px,3fr)] grid-rows-[minmax(0,1fr)_auto] gap-3">
  <div className="flex min-h-0 flex-col gap-3"><section className="pos-display-copy shrink-0 rounded-2xl bg-white p-4 shadow-sm"><header><div className="flex items-center justify-between gap-3"><p className="text-xs font-bold tracking-[.18em] text-blue-600">TDK POS</p><div className="flex items-center gap-1"><button aria-label="POS 데이터 새로고침" title="POS 데이터 새로고침" disabled={menuRefreshing} onClick={refreshPosData} className={`${POS_TOP_CONTROL_CLASS_NAME} h-[30px] w-[30px] shrink-0 p-0 text-base disabled:opacity-50`} type="button">↻</button><button aria-label="영업준비금 등록" onClick={() => setOpeningFundModal(true)} className={POS_TOP_CONTROL_CLASS_NAME} type="button">시재</button><button aria-pressed={fullscreen} onClick={() => void handleFullscreen()} className={`${POS_TOP_CONTROL_CLASS_NAME} whitespace-nowrap`} type="button">{fullscreen ? "전체화면 종료" : "전체화면"}</button><button onClick={() => { setExitMessage(""); setExitDialogOpen(true); }} className={POS_TOP_CONTROL_CLASS_NAME} type="button">{text.exit}</button></div></div><h1 className="mt-1 text-xl font-bold">{text.store}</h1><div className="mt-2 flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="text-sm font-semibold">{staffName} · {staffRole}</span><LogoutButton /></div><time className="text-xs text-slate-500">{new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date())}</time></div></header></section>
  <OrderSummaryPanel selected={selected} customerSelectOpen={customerSelectOpen} setCustomerSelectOpen={setCustomerSelectOpen} items={items} total={displayTotal} cart={cart} cartTotal={cartTotal} tab={tab} setTab={setTab} submitCart={submitCart} clearCart={() => { setCart([]); setOrderError(""); setTab("summary"); }} adjustCartItem={adjustCartItem} adjustCartComponent={adjustCartComponent} submitting={submittingOrder} submitError={orderError} orderDetails={orderDetails} workspaceResetVersion={menuResetVersion} selectionVersion={selectionVersion} onBlockingUiChange={setOrderSummaryBlockingUiOpen} onCancellationSuccess={() => router.refresh()} onPaymentCompleted={handlePaymentCompleted} onCashPaymentRegistered={() => void handleOpenCashDrawer()} onBusinessOpeningRequired={requireBusinessOpening} onPrintReceipt={(checkoutId, isReprint) => sendReceipt(checkoutId ? { checkoutId, isReprint } : { tableId: selected?.tableId })} receiptPrinting={receiptPrinting} party={selectedParty} physicalSessionIds={selectedPhysicalSessionIds} sessionTableNos={Object.fromEntries([...displayTables, ...displayTakeouts].flatMap(table => table.sessionId === null ? [] : [[table.sessionId, table.tableNo]]))} discounts={discounts} menuModifiers={menuModifiers} potMenuIds={menus.filter(menu => menu.kdsKind === "POT").map(menu => menu.menuId)} onOptionSaved={(sessionId, optionName, orderItemId) => { setTableSpicyOverrides(current => ({ ...current, [sessionId]: { name: optionName, orderItemId, expiresAt: Date.now() + 10000 } })); router.refresh(); }} /></div>
  <section className={`grid min-h-0 ${view === "takeout" ? "grid-rows-[10%_minmax(0,1fr)]" : view === "tables" ? "grid-rows-[10%_minmax(0,1fr)_minmax(140px,18%)]" : "grid-rows-[10%_60%_30%]"} rounded-2xl bg-white shadow-sm`} data-pos-middle-panel style={view === "tables" ? { gridTemplateRows: POS_TABLE_GRID_ROWS } : undefined}><div className="flex min-h-0 flex-col justify-center px-4" data-pos-top-tabs><div className="grid w-full grid-cols-4 gap-2">{([ ["tables", `테이블(${openTableCount})`], ["takeout", `포장(${displayTakeouts.length})`], ["reservation", "예약(0)"], ["waiting", "대기자(0)"] ] as const).map(([key, name]) => <button key={key} onClick={() => changeWorkTab(key)} className={`relative overflow-hidden whitespace-nowrap rounded-xl px-1 py-3 text-sm font-bold ${view === key ? `${viewTabStyles[key].activeClass} text-white` : "bg-slate-100 text-slate-600"}`} type="button"><span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 size-7 rounded-br-[2rem] brightness-75" style={{ backgroundColor: viewTabStyles[key].color }} /><span className="relative">{name}</span></button>)}</div><div aria-hidden="true" className={`mt-1.5 h-[3px] w-full rounded-full ${viewTabStyles[view].activeClass}`} /></div>{view === "tables" ? <><TableLayoutRenderer tables={displayTables} renderTable={(table, fixedPosition) => <TableVisual fixedPosition={fixedPosition} selectedGroupId={selectedGroupId} table={table} tables={displayTables} selected={table.tableId === selectedId} choose={() => choose(table)} />} className="justify-self-center rounded-2xl border border-dashed border-slate-300 bg-slate-50" debugName="pos-table-area" style={{ width: "calc(100% - 2rem)", overflow: "visible" }} /><div className="min-h-0 px-4 pb-4 pt-1.5"><RequestMessagePanel /></div></> : view === "takeout" ? <TakeoutPanel sessions={takeoutPanelSessions} selectedId={selectedId} onSelect={selectTakeout} onCreated={takeoutCreated} onCancelled={takeoutCancelled} onBlockingUiChange={setTakeoutBlockingUiOpen} onBusinessOpeningRequired={requireBusinessOpening} /> : <><p className="flex min-h-0 items-center justify-center px-4 text-sm text-slate-400">준비 중입니다.</p><div aria-hidden="true" className="min-h-0" /></>}</section>
  <PosMenuPanel canOrderMenu={canOrderMenu} categories={categories} menus={menus} openQuantityModal={openQuantityModal} quickAddToCart={quickAddToCart} resetVersion={menuResetVersion} refreshError={menuRefreshError} />
  <PosFooterBar><button aria-label="공기밥 현재수량 및 수량 조절" data-digits={String(riceCurrentQty ?? 0).length} className="rice-stock-count h-[72px] rounded-xl bg-slate-100 text-slate-800 transition hover:bg-slate-200 disabled:opacity-50" disabled={riceCurrentQty === null} onClick={() => setRiceStockModal(true)} type="button">{riceCurrentQty ?? ""}</button><button aria-label="판매내역" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200" onClick={() => router.push("/pos/sales")} type="button">판매</button><button aria-label="CashBox" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed" disabled={drawerOpening} onClick={() => void handleOpenCashDrawer()} type="button">{drawerOpening ? "여는 중..." : "CashBox"}</button><button aria-label="영수증" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed" disabled={receiptPrinting} onClick={() => void printSelectedReceipt()} type="button">{receiptPrinting ? "출력 중..." : "영수증"}</button><button aria-label="고객 선택" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={!selected?.sessionId} onClick={() => setCustomerSelectOpen(true)} type="button">고객</button><button aria-label="인원 조정" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed" disabled={!selected?.sessionId} onClick={() => { if (!selected?.sessionId) return; setPersonError(""); setPersonModal(true); }} type="button">인원</button><button aria-label="할인" className="h-[72px] rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed" disabled={!selected?.sessionId || physicalAggregateTotal <= 0} onClick={() => setDiscountModal(true)} type="button">할인</button><button aria-label="테이블 관리" className="flex h-[72px] items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 transition hover:bg-slate-200 active:scale-[0.99]" onClick={() => router.push("/pos/table-management")} type="button"><svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><rect height="13" rx="1" width="16" x="4" y="5" /><path d="M8 18v2M16 18v2M8 9h3M13 9h3M8 13h3M13 13h3" /></svg><span>테이블관리</span></button></PosFooterBar></div>{firstOrderPersonModal && selected && !selected.sessionId && <PersonCountModal key={selected.tableId} title="인원 확인" personCount={firstOrderAdultCount > 0 ? firstOrderAdultCount : selected.personCount ?? 0} babyCount={0} busy={firstOrderBusy} error={firstOrderError} close={() => !firstOrderBusy && setFirstOrderPersonModal(false)} save={confirmFirstOrder} />}{personModal && selected?.sessionId && <PersonCountModal sessionId={selected.sessionId} personCount={selected.personCount ?? 0} babyCount={selected.babyCount ?? 0} busy={personBusy} error={personError} close={() => !personBusy && setPersonModal(false)} save={savePersonCount} />}{discountModal && selected?.sessionId && <DiscountModal sessionId={selected.sessionId} table={selected} items={items} subtotal={physicalAggregateTotal} savedDiscounts={selectedDiscounts} close={() => setDiscountModal(false)} completed={() => { setDiscountModal(false); router.refresh(); }} />}{riceStockModal && <RiceStockModal close={() => { setRiceStockModal(false); router.refresh(); }} onAdjusted={() => router.refresh()} />}{businessOpening && <OpeningFundModal context="login" close={() => { openingRetry.current = null; openingPromptDismissed.current = true; try { window.sessionStorage.setItem(OPENING_FUND_PROMPT_DISMISSED_KEY, "1"); } catch { /* The current POS session still remembers the dismissal. */ } setBusinessOpening(false); }} onSaved={() => { const retry = openingRetry.current; openingRetry.current = null; setBusinessOpening(false); retry?.(); }} drawerOpening={drawerOpening} onOpenCashDrawer={() => void handleOpenCashDrawer()} />}{businessClosing && <BusinessClosingDialog onClose={() => setBusinessClosing(false)} onClosed={() => { setBusinessClosing(false); setBusinessCloseConfirmed(true); setExitMessage(""); setShutdownConfirmOpen(true); }} />}{openingFundModal && <OpeningFundModal mode="cashCheck" close={() => setOpeningFundModal(false)} drawerOpening={drawerOpening} onOpenCashDrawer={() => void handleOpenCashDrawer()} />}{quantityMenu && <QuantityModal key={quantityMenu.menuId} menu={quantityMenu} stale={quantityMenuChanged} components={quantityMenuConfig?.components ?? []} modifiers={quantityMenuConfig?.modifiers ?? []} inheritedChoiceId={tableSpicyChoice(quantityMenu)?.modifierOptionId ?? null} close={() => setQuantityMenu(null)} add={(unitPrice, qty, options, components, isComplimentary) => { addToCart(quantityMenu, unitPrice, qty, options, components, isComplimentary); setQuantityMenu(null); }} />}{receiptNotice && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4"><section aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-2xl" role="alertdialog"><h2 className={`text-2xl font-extrabold ${receiptNotice.success ? "text-blue-700" : "text-red-600"}`}>{receiptNotice.title}</h2><p className="mt-5 whitespace-pre-line text-lg text-slate-600">{receiptNotice.message}</p><button autoFocus className="mt-7 min-h-14 w-full rounded-xl bg-blue-600 text-lg font-bold text-white" onClick={() => setReceiptNotice(null)} type="button">확인</button></section></div>}{exitDialogOpen && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => { if (!shutdownConfirmOpen) { setExitDialogOpen(false); setExitMessage(""); } }}><section aria-modal="true" className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()} role="dialog"><PosSubHeader backLabel="종료 선택 닫기" onBack={() => { setExitDialogOpen(false); setExitMessage(""); }} title="TDK-POS 종료" /><div className="p-6"><div className="flex gap-5"><button className="min-h-[72px] flex-1 rounded-xl border border-slate-300 bg-slate-100 text-lg font-extrabold text-slate-800 hover:bg-slate-200" onClick={() => { setExitMessage(""); setShutdownConfirmOpen(true); }} type="button">시스템 종료</button><button className="min-h-[72px] flex-1 rounded-xl bg-red-600 text-lg font-extrabold text-white hover:bg-red-700 disabled:opacity-50" disabled={posExitBusy} onClick={() => { setExitMessage(""); if (businessCloseConfirmed) setShutdownConfirmOpen(true); else setBusinessClosing(true); }} type="button">{posExitBusy ? "POS 종료 중..." : "영업마감 후 종료"}</button></div>{exitMessage && !shutdownConfirmOpen && <p className="mt-4 text-center text-sm font-semibold text-slate-600" role="status">{exitMessage}</p>}</div></section>{shutdownConfirmOpen && <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4" onClick={() => { if (!shutdownBusy) setShutdownConfirmOpen(false); }}><section aria-modal="true" className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()} role="alertdialog"><PosSubHeader backLabel="종료 선택으로 돌아가기" disabled={shutdownBusy} onBack={() => setShutdownConfirmOpen(false)} title="시스템 종료" /><div className="p-6 text-center"><p className="text-lg font-bold text-slate-800">POS 컴퓨터를 종료하시겠습니까?</p>{exitMessage && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{exitMessage}</p>}<button autoFocus className="mt-6 min-h-[60px] w-full rounded-xl bg-red-600 text-lg font-extrabold text-white disabled:cursor-wait disabled:opacity-50" disabled={shutdownBusy} onClick={() => void handleSystemShutdown()} type="button">{shutdownBusy ? "종료 요청 중..." : "시스템 종료"}</button></div></section></div>}</div>}</main>;
}
function PosMenuPanel({ menus, categories, canOrderMenu, openQuantityModal, quickAddToCart, resetVersion, refreshError }: { menus: Menu[]; categories: Category[]; canOrderMenu: boolean; openQuantityModal: (menu: Menu) => void; quickAddToCart: (menu: Menu) => void; resetVersion: number; refreshError: string }) {
 const listRef = useRef<HTMLDivElement>(null);
 const [categorySelection, setCategorySelection] = useState(() => ({ categoryId: null as number | null, resetVersion }));
 const requestedCategoryId = categorySelection.resetVersion === resetVersion ? categorySelection.categoryId : null;
 const activeCategoryId = requestedCategoryId !== null && !categories.some(category => category.categoryId === requestedCategoryId) ? null : requestedCategoryId;
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
 const renderMenuCard = (menu: Menu) => { const openMenu = () => openQuantityModal(menu); return <div aria-label={`${menu.name} 상세`} className="pos-menu-card pos-menu-card-with-cart" style={{ "--pos-menu-accent": categoryVisual(menu.categoryName).color } as CSSProperties} data-category={menu.categoryId ?? "uncategorized"} key={menu.menuId} onClick={openMenu} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openMenu(); } }} role="button" tabIndex={0}>{menu.menuNumber !== null && <span aria-hidden="true" className="pos-menu-number">{menu.menuNumber}</span>}<div className="pos-menu-copy"><strong>{menu.name}</strong><span className="pos-menu-price">{new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Number(menu.price))}</span></div><button aria-label={`${menu.name} 주문예정에 1개 추가`} className="pos-menu-cart-button" onClick={event => { event.stopPropagation(); quickAddToCart(menu); }} onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} type="button"><img src="/icons/cart_plus_icon.svg" alt="" aria-hidden="true" className="pointer-events-none size-[22px]" /></button></div>; };
 return <section className="pos-right-menu-panel pos-right-menu-panel-aligned min-h-0 rounded-2xl bg-white px-4 pb-4 shadow-sm"><div className="pos-menu-header"><div className="flex min-w-0 items-center gap-1"><div className={`horizontal-select-scroll pos-category-bar min-w-0 flex-1${categoryTabs.length === 6 ? " is-six-items" : ""}`} {...categoryScrollHandlers} ref={categoryScrollRef}>{categoryTabs.map(category => { const visual = category.categoryId === null ? { color: viewTabStyles.tables.color } : categoryVisual(category.name); const active = activeCategoryId === category.categoryId; return <button className={`pos-category-button${active ? " is-active" : ""}`} disabled={!canOrderMenu} key={category.categoryId ?? "all"} onClick={() => selectCategory(category.categoryId)} style={active ? { backgroundColor: visual.color } : undefined} type="button"><span aria-hidden="true" className="pos-category-corner-marker" style={{ backgroundColor: visual.color }} /><span className="relative">{categoryDisplayName(category.name)}</span></button>; })}</div></div><div aria-hidden="true" className="pos-category-underline" style={{ backgroundColor: activeCategoryColor }} /></div>{refreshError && <p className="mb-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700" role="alert">{refreshError}</p>}<div className="pos-menu-list" ref={listRef}>{Array.from({ length: Math.ceil(filteredMenus.length / 3) }, (_, rowIndex) => { const row = filteredMenus.slice(rowIndex * 3, rowIndex * 3 + 3); return <div className="pos-menu-row" key={row[0].menuId}>{row.map(renderMenuCard)}</div>; })}</div></section>;
}
function TableVisual({ table, tables, selected, selectedGroupId, choose, fixedPosition }: { table: Table; tables: Table[]; selected: boolean; selectedGroupId: number | null; choose: () => void; fixedPosition: ReturnType<typeof posMainFixedTablePosition> }) {
 const guestCount = (table.personCount ?? 0) + (table.babyCount ?? 0);
 const grouped = selectedGroupId !== null && table.groupId === selectedGroupId && !selected;
 return <TableShape {...table} fixedPosition={fixedPosition} grouped={grouped} partyRelationHighlight={grouped && !selected} partyTableNos={partyPeerTableNos(table, tables)} posMainTable guestCount={guestCount} hasOpenSession={table.sessionId !== null} sageOccupied hasQrOrder={table.hasQrOrder} qrLanguageCode={table.qrLanguageCode} onClick={choose} partyHighlight={selected && selectedGroupId !== null} selected={selected} thickSelection={selected} startedAt={table.openedAt} tableNumber={table.tableNo} />;
}
function ProvisionSegmentedToggle({ label, enabled, onChange }: { label: string; enabled: boolean; onChange: (enabled: boolean) => void }) {
 const gestureRef = useRef<{ pointerId: number; startX: number; startOffset: number; segmentWidth: number; dragged: boolean; offset: number } | null>(null);
 const clickSuppressionRef = useRef(false);
 const clickTimerRef = useRef<number | null>(null);
 const snapTimerRef = useRef<number | null>(null);
 const snapFrameRef = useRef<number | null>(null);
 const [dragOffset, setDragOffset] = useState<number | null>(null);
 const [dragging, setDragging] = useState(false);
 useEffect(() => () => { if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current); if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current); if (snapFrameRef.current !== null) window.cancelAnimationFrame(snapFrameRef.current); }, []);
 const snapTo = (from: number, to: number) => {
  setDragging(false);
  setDragOffset(from);
  if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
  if (snapFrameRef.current !== null) window.cancelAnimationFrame(snapFrameRef.current);
  snapFrameRef.current = window.requestAnimationFrame(() => {
   setDragOffset(to);
   snapFrameRef.current = null;
   snapTimerRef.current = window.setTimeout(() => { setDragOffset(null); snapTimerRef.current = null; }, 200);
  });
 };
 const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
  if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current);
  if (snapFrameRef.current !== null) window.cancelAnimationFrame(snapFrameRef.current);
  const segmentWidth = event.currentTarget.querySelector("button")?.getBoundingClientRect().width ?? 64;
  const startOffset = enabled ? segmentWidth : 0;
  gestureRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset, segmentWidth, dragged: false, offset: startOffset };
  event.currentTarget.setPointerCapture(event.pointerId);
 };
 const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
  const gesture = gestureRef.current;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const delta = event.clientX - gesture.startX;
  if (!gesture.dragged && Math.abs(delta) < 6) return;
  gesture.dragged = true;
  gesture.offset = Math.min(gesture.segmentWidth, Math.max(0, gesture.startOffset + delta));
  setDragging(true);
  setDragOffset(gesture.offset);
 };
 const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
  const gesture = gestureRef.current;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  gestureRef.current = null;
  const offset = Math.min(gesture.segmentWidth, Math.max(0, gesture.startOffset + event.clientX - gesture.startX));
  const next = gesture.dragged ? offset >= gesture.segmentWidth / 2 : event.clientX >= event.currentTarget.getBoundingClientRect().left + event.currentTarget.getBoundingClientRect().width / 2;
  if (gesture.dragged) snapTo(offset, next ? gesture.segmentWidth : 0);
  else { setDragging(false); setDragOffset(null); }
  onChange(next);
  clickSuppressionRef.current = true;
  if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
  clickTimerRef.current = window.setTimeout(() => { clickSuppressionRef.current = false; clickTimerRef.current = null; }, 0);
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
 };
 const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
  const gesture = gestureRef.current;
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  gestureRef.current = null;
  if (gesture.dragged) snapTo(gesture.offset, gesture.startOffset);
  else { setDragging(false); setDragOffset(null); }
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
 };
 return <div className="flex min-h-11 items-center justify-center gap-2 px-2">
  <span className="whitespace-nowrap text-sm font-semibold text-slate-800">{label}</span>
  <div aria-label={`${label} 제공 여부`} className="relative inline-grid shrink-0 grid-cols-2 rounded-full bg-slate-100 p-1 touch-pan-y" onClickCapture={event => { if (clickSuppressionRef.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); clickSuppressionRef.current = false; } }} onLostPointerCapture={handlePointerCancel} onPointerCancel={handlePointerCancel} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} role="group">
   <div aria-hidden="true" className="pointer-events-none absolute inset-1 grid grid-cols-2"><span className={`col-start-1 rounded-full ${dragging ? "transition-none" : "transition-[transform,background-color] duration-200 ease-out motion-reduce:transition-none"} ${enabled ? "bg-blue-600" : "bg-slate-300"}`} style={{ transform: dragOffset === null ? `translateX(${enabled ? "100%" : "0%"})` : `translateX(${dragOffset}px)` }} /></div>
   <button aria-pressed={!enabled} className={`relative z-10 h-10 w-16 rounded-full text-xs font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${enabled ? "text-slate-500" : "text-slate-800"}`} onClick={() => onChange(false)} type="button">미제공</button>
   <button aria-pressed={enabled} className={`relative z-10 h-10 w-16 rounded-full text-xs font-extrabold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${enabled ? "text-white" : "text-slate-500"}`} onClick={() => onChange(true)} type="button">제공</button>
  </div>
 </div>;
}
function QuantityModal({ menu, modifiers, components, inheritedChoiceId, stale, close, add }: { menu: Menu; modifiers: MenuModifier[]; components: MenuComponent[]; inheritedChoiceId: number | null; stale: boolean; close: () => void; add: (unitPrice: number, qty: number, options: PendingCartItem["options"], components: SelectedMenuComponent[], isComplimentary: boolean) => void }) {
 const [unitPrice, setUnitPrice] = useState(() => Number(menu.price)); const [qty, setQty] = useState(1); const [quickQty, setQuickQty] = useState<number | null>(null); const [expanded, setExpanded] = useState(false); const [buffer, setBuffer] = useState(""); const [validationMessage, setValidationMessage] = useState("");
 const [activeInputField, setActiveInputField] = useState<"price" | "qty" | null>(null);
 const addInProgressRef = useRef(false);
 const [isComplimentary, setIsComplimentary] = useState(false);
 const [componentEnabled, setComponentEnabled] = useState<Record<number, boolean>>(() => Object.fromEntries(components.map(component => [component.menuComponentId, true])) as Record<number, boolean>);
 const { title: choiceTitle, options: choiceOptions, selected: defaultChoice } = getMenuChoice(modifiers);
 const [selectedChoiceId, setSelectedChoiceId] = useState<number | null>(() => inheritedChoiceId ?? defaultChoice?.modifierOptionId ?? null);
 const formatMoney = (value: number) => formatPosMoney(value); const quickLabel = (value: number) => components.length ? `${value}` : `${value}개`; const selectedChoice = choiceOptions.find(option => option.modifierOptionId === selectedChoiceId); const options = selectedChoice ? [{ modifierGroupId: selectedChoice.modifierGroupId, modifierOptionId: selectedChoice.modifierOptionId, optionName: selectedChoice.optionName, priceDelta: Number(selectedChoice.priceDelta), qty: 1 }] : [];
 const selectedComponentsForQty = (parentQty: number) => components.map(component => ({ menuComponentId: component.menuComponentId, qty: (componentEnabled[component.menuComponentId] ?? true) ? component.quantity * parentQty : 0 }));
 const confirmAdd = (selectedQty: number) => { if (addInProgressRef.current) return; if (stale) { setValidationMessage("메뉴 정보가 변경되었습니다. 창을 닫고 메뉴를 다시 선택해 주세요."); return; } if (!Number.isSafeInteger(selectedQty) || selectedQty < 1 || !Number.isFinite(unitPrice) || unitPrice < 0) { setValidationMessage("수량과 금액을 확인하세요."); return; } addInProgressRef.current = true; setValidationMessage(""); try { add(unitPrice, selectedQty, options, selectedComponentsForQty(selectedQty), isComplimentary); } catch { addInProgressRef.current = false; setValidationMessage("주문 추가에 실패했습니다. 다시 시도하세요."); } };
 const addToCart = () => confirmAdd(qty);
 const chooseQuick = (value: number) => { setQty(value); setQuickQty(value); setValidationMessage(""); if (!expanded) confirmAdd(value); };
 const applyBuffer = (field: "price" | "qty") => { setActiveInputField(field); const value = Number(buffer); if (!buffer || !Number.isSafeInteger(value) || (field === "qty" && value < 1)) { setValidationMessage(field === "qty" ? "수량은 1 이상으로 입력하세요." : "금액을 입력하세요."); return; } if (field === "price") setUnitPrice(value); else { setQty(value); setQuickQty(null); } setBuffer(""); setValidationMessage(""); };
 const handleKeypad = (key: string) => { if (key === "C") { setBuffer(""); return; } if (key === "00") { setBuffer(value => value ? `${value}00` : ""); return; } setBuffer(value => `${value}${key}`.replace(/^0+(?=\d)/, "")); };
 useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [close]);
 return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4" onClick={close}>
  <section aria-labelledby="quantity-modal-title" aria-modal="true" className={`flex h-auto flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-xl transition-[width,max-width] duration-200 ease-out ${expanded ? "min-h-[28.5rem] w-full max-w-[calc(100vw-2rem)] md:max-w-2xl" : `${choiceOptions.length ? "min-h-[24.5rem]" : ""} w-[520px] max-w-[calc(100vw-4rem)]`}`} data-expanded={expanded} onClick={event => event.stopPropagation()} role="dialog">
   <PosSubHeader backLabel="메뉴 선택 닫기" className="-mx-5 -mt-5" onBack={close} title={menu.name} titleId="quantity-modal-title" titleTrailing={<strong className="ml-2 shrink-0 whitespace-nowrap text-base font-extrabold">{formatMoney(isComplimentary ? 0 : (unitPrice + options.reduce((sum, option) => sum + option.priceDelta * option.qty, 0)) * qty)}</strong>} trailing={<button aria-label={expanded ? "간단 주문 옵션" : "상세 주문 옵션"} className="min-h-11 shrink-0 bg-transparent px-2 text-sm font-semibold text-white/75 transition-colors hover:text-white active:text-white" onClick={() => setExpanded(value => !value)} type="button">{expanded ? "간단 ‹" : "상세 ›"}</button>} />
   <div className={`grid min-h-0 flex-1 ${expanded ? "grid-cols-[minmax(0,1fr)_13.5rem]" : "grid-cols-1"}`}>
    <div className={`flex flex-col gap-5 pt-5 ${expanded ? "pr-4" : ""}`}>
     {choiceOptions.length > 0 && <div className={`w-full rounded-xl border border-slate-200 bg-white p-2 ${choiceTitle.trim() ? "" : "flex min-h-[68px] items-center justify-center"}`}>{choiceTitle.trim() && <p className="mb-2 text-xs font-bold text-slate-600 select-none">{choiceTitle}</p>}<div className="grid w-full gap-1.5" style={{ gridTemplateColumns: `repeat(${choiceOptions.length}, minmax(0, 1fr))` }}>{choiceOptions.map(option => <button className={`min-h-[52px] rounded-lg px-2 text-[11px] font-bold ${selectedChoiceId === option.modifierOptionId ? "border border-blue-600 bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`} key={option.modifierOptionId} onClick={() => setSelectedChoiceId(option.modifierOptionId)} type="button">{option.optionName}</button>)}</div></div>}
     <div className="w-full rounded-xl border border-slate-200 bg-white px-3 py-4">
      <div className="grid w-full grid-cols-[108px_108px] justify-evenly gap-y-6">{[1,2,3,4].map(value => <button aria-pressed={quickQty === value} className="h-[84px] w-[108px] rounded-lg border border-slate-300 bg-slate-50 text-xl font-extrabold text-slate-800 shadow-none transition hover:bg-slate-100 active:bg-slate-200 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600" key={value} onClick={() => chooseQuick(value)} type="button">{quickLabel(value)}</button>)}</div>
     </div>
     <div className="grid w-full grid-cols-2 rounded-xl border border-slate-200 bg-white p-3 select-none">
      <ProvisionSegmentedToggle enabled={isComplimentary} label="무료" onChange={setIsComplimentary} />
      <div className="min-w-0 space-y-1 border-l border-slate-200 px-2">
       {components.map(component => <ProvisionSegmentedToggle enabled={componentEnabled[component.menuComponentId] ?? true} key={component.menuComponentId} label={component.itemName} onChange={enabled => setComponentEnabled(current => ({ ...current, [component.menuComponentId]: enabled }))} />)}
      </div>
     </div>
    </div>
    {expanded && <aside className="space-y-3 border-l border-slate-300 px-4 pt-4">
     <section aria-label="숫자 입력 키패드" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <p className="min-h-11 border-b border-slate-200 bg-slate-50 px-3 py-2 text-right text-lg font-extrabold text-slate-800">{buffer ? new Intl.NumberFormat("ko-KR").format(Number(buffer)) : "0"}</p>
      <div className="grid grid-cols-3 gap-1.5 p-2">{["1","2","3","4","5","6","7","8","9","00","0","C"].map(key => <button className="min-h-10 rounded-lg bg-slate-100 text-base font-bold active:scale-[0.98]" key={key} onClick={() => handleKeypad(key)} type="button">{key}</button>)}</div>
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
   {(stale || validationMessage) && <p className="mt-3 text-sm font-medium text-red-600" role="alert">{stale ? "메뉴 정보가 변경되었습니다. 창을 닫고 메뉴를 다시 선택해 주세요." : validationMessage}</p>}
   {expanded && <footer className="mt-3 border-t border-slate-200 pt-3"><button className="min-h-12 w-full rounded-xl bg-blue-600 text-base font-bold text-white active:scale-[0.99]" onClick={addToCart} type="button">추가</button></footer>}
  </section>
 </div>;

}
