"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { getMenuChoice } from "@/lib/menu-choice-selection";
import { clampHosRemainingQuantity, getHosCancellationQuantity } from "@/lib/hos-order-quantity";
import { getHosMenuCategoryAtTop } from "@/lib/hos-menu-scroll";
import { menuCategoryDisplayName } from "@/lib/menu-category-display";
import { formatTradeBalance, tradeDescription, tradeTypeLabel, type CustomerTradeDetail, type CustomerTradeDetailResponse,
  type CustomerTradeResponse, type CustomerTradeRow } from "@/lib/customer-trade";
import HosTableCanvas from "./HosTableCanvas";

type TableRow = {
  tableId: number; tableNo: string; tableName: string | null; positionX: number; positionY: number;
  layoutWidth: number; layoutHeight: number; isVisible: boolean; sessionId: number | null;
  amountDue: number; personCount?: number | null; babyCount?: number | null; openedAt?: string | null; customerName?: string | null; hasQrOrder?: boolean; hasTableToken?: boolean; mergedSourceTableNos: string[];
  isMergedSource: boolean; mergedIntoTableNo: string | null;
};
type OrderItem = {
  orderItemId: number; menuId: number | null; parentOrderItemId: number | null; itemType: string;
  itemName: string; qty: number; unitPrice: string; totalAmount: string; effectiveQty: number; cancelledQty: number; status: string;
  options: Array<{ optionName: string; qty: number; unitPrice: string }>;
};
type TableDetail = {
  table: { tableId: number; tableNo: string; tableName: string | null };
  session: { sessionId: number; relatedSessionIds: number[]; customerId: number | null; customerName: string | null } | null;
  orders: Array<{ orderId: number; status: string; orderedAt: string; totalAmount: string; items: OrderItem[] }>;
};
type HosCustomer = { customerId: number; name: string; isPaymentManaged: boolean; createdAt: string; tradeBalance?: number };
type TradePeriod = "all" | "90" | "30" | "month";
type Menu = { menuId: number; categoryId: number | null; name: string; price: string; categoryName: string | null };
type Modifier = { menuId: number; modifierGroupId: number; groupName: string; choiceDefaultOptionId: number | null;
  modifierOptionId: number; optionName: string; priceDelta: string; optionSortOrder: number };
type Component = { menuComponentId: number; menuId: number; componentMenuId: number; itemName: string; quantity: number };
type Catalog = { menus: Menu[]; categories: Array<{ categoryId: number; name: string }>; modifiers: Modifier[]; components: Component[] };
type DraftItem = { menuId: number; name: string; qty: number; options: Array<{ modifierOptionId: number; qty: number }>; components: Array<{ menuComponentId: number; qty: number }> };
type PendingCancel = { orderItemId: number; keepQty: number };
type CartPoint = { x: number; y: number };
type CartFlight = CartPoint & { id: number; dx: number; dy: number };

function FlyingCart({ flight, active, onComplete }: { flight: CartFlight; active: boolean; onComplete: (id: number) => void }) {
  const iconRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!active) {
      onComplete(flight.id);
      return;
    }
    const icon = iconRef.current;
    if (!icon) return;
    const animation = icon.animate([
      { transform: "translate(0, 0) scale(1)", opacity: 1, offset: 0 },
      { transform: `translate(${flight.dx * 0.5}px, ${flight.dy * 0.5 - 36}px) scale(0.72)`, opacity: 0.78, offset: 0.55 },
      { transform: `translate(${flight.dx}px, ${flight.dy}px) scale(0.2)`, opacity: 0, offset: 1 },
    ], { duration: 500, easing: "cubic-bezier(0.22, 0.8, 0.25, 1)" });
    animation.onfinish = () => onComplete(flight.id);
    return () => animation.cancel();
  }, [active, flight, onComplete]);

  if (!active) return null;

  return <span aria-hidden="true" className="pointer-events-none fixed z-[9999] flex size-[30px] items-center justify-center rounded-full bg-white text-blue-600 shadow-md ring-1 ring-blue-100" ref={iconRef}
    style={{ left: flight.x - 15, top: flight.y - 15 }}>
    <svg className="size-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 1.9-1.4L21 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg>
  </span>;
}

const money = (amount: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(amount);
function koreaToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
function shiftDate(date: string, days: number) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body) {
    const message = (body as { message?: string } | null)?.message;
    throw new Error(message || `요청에 실패했습니다. (HTTP ${response.status})`);
  }
  return body;
}

const HOS_SESSION_EXPIRED_EVENT = "tdk-hos-session-expired";
const HOS_TOAST_DURATION_KEY = "tdk-hos-toast-duration-seconds";
const HOS_TOAST_DURATIONS = [1, 2, 3, 5, 10] as const;
async function fetchHos(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(HOS_SESSION_EXPIRED_EVENT));
  }
  return response;
}

export default function HosHome({ staffLoginId }: { staffLoginId: string | null }) {
  const router = useRouter();
  const sessionRefreshRequestedRef = useRef(false);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [dividerPositions, setDividerPositions] = useState<number[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [screen, setScreen] = useState<"tables" | "detail" | "menu" | "customer" | "balance" | "tradeDetail">("tables");
  const [hosCustomers, setHosCustomers] = useState<HosCustomer[]>([]);
  const [customersLoadedKey, setCustomersLoadedKey] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [balanceView, setBalanceView] = useState(false);
  const [managedCustomersOnly, setManagedCustomersOnly] = useState(true);
  const [balanceCustomer, setBalanceCustomer] = useState<{ customerId: number; name: string } | null>(null);
  const [tradePeriod, setTradePeriod] = useState<TradePeriod>("month");
  const [tradeDataState, setTradeDataState] = useState<{ key: string; data: CustomerTradeResponse } | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<CustomerTradeRow | null>(null);
  const [tradeDetailState, setTradeDetailState] = useState<{ key: string; detail: CustomerTradeDetail } | null>(null);
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [cancellations, setCancellations] = useState<PendingCancel[]>([]);
  const [pendingTableId, setPendingTableId] = useState<number | null>(null);
  const [cancelMode, setCancelMode] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [cartFlights, setCartFlights] = useState<CartFlight[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancellationReason, setCancellationReason] = useState("고객 요청");
  const [cancellationDetail, setCancellationDetail] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [logoutMenuOpen, setLogoutMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastDuration, setToastDuration] = useState<number>(2);
  const [toastDurationLoaded, setToastDurationLoaded] = useState(false);
  const [successToast, setSuccessToast] = useState<{ message: string; position: "top" | "center" } | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [exitMessage, setExitMessage] = useState("");
  const clearDraftLockRef = useRef(false);
  const fullCancelLockRef = useRef(false);
  const successToastTimerRef = useRef<number | null>(null);
  const sendLock = useRef(false);
  const optionAddLockRef = useRef(false);
  const tableRequestRef = useRef<Promise<void> | null>(null);
  const detailRequestVersionRef = useRef(0);
  const activeDetailTableIdRef = useRef<number | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const tableScreenRef = useRef<HTMLElement | null>(null);
  const logoutMenuRef = useRef<HTMLDivElement | null>(null);
  const logoutMenuHistoryRef = useRef(false);
  const menuTabsRef = useRef<HTMLDivElement | null>(null);
  const cartSummaryRef = useRef<HTMLSpanElement | null>(null);
  const cartPulseAnimationRef = useRef<Animation | null>(null);
  const cartFlightIdRef = useRef(0);
  const menuListRef = useRef<HTMLDivElement | null>(null);
  const menuSectionRefs = useRef(new Map<number, HTMLElement>());
  const menuTabRefs = useRef(new Map<number | null, HTMLButtonElement>());
  const menuScrollAnimationRef = useRef<number | null>(null);
  const menuScrollTargetRef = useRef<number | null>(null);
  const programmaticMenuScrollRef = useRef(false);
  const keepMenuOpenAfterOptionRef = useRef(false);
  const optionFlightOriginRef = useRef<CartPoint | null>(null);
  const closeLogoutMenu = useCallback(() => {
    if (!logoutMenuOpen) return;
    setLogoutMenuOpen(false);
    if (logoutMenuHistoryRef.current) {
      logoutMenuHistoryRef.current = false;
      window.history.back();
    }
  }, [logoutMenuOpen]);

  useEffect(() => {
    const refreshForExpiredSession = () => {
      if (sessionRefreshRequestedRef.current) return;
      sessionRefreshRequestedRef.current = true;
      router.refresh();
    };
    window.addEventListener(HOS_SESSION_EXPIRED_EVENT, refreshForExpiredSession);
    return () => window.removeEventListener(HOS_SESSION_EXPIRED_EVENT, refreshForExpiredSession);
  }, [router]);

  const loadTables = useCallback((manual = false) => {
    if (manual) setManualRefreshing(true);
    if (tableRequestRef.current) return tableRequestRef.current;
    setRefreshing(true);
    const request = (async () => {
      try {
        const result = await readJson<{ tables: TableRow[]; dividerPositions?: number[] }>(await fetchHos("/api/hos/tables", { cache: "no-store" }));
        setTables(result.tables);
        setDividerPositions(Array.isArray(result.dividerPositions) ? result.dividerPositions : []);
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "테이블 정보를 불러오지 못했습니다.");
      } finally {
        setRefreshing(false);
        setManualRefreshing(false);
        tableRequestRef.current = null;
      }
    })();
    tableRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (screen !== "tables") return;
    const firstLoad = window.setTimeout(() => void loadTables(), 0);
    const timer = window.setInterval(() => void loadTables(), 6000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(timer);
    };
  }, [loadTables, screen]);

  useEffect(() => {
    if (!logoutMenuOpen) return;
    window.history.pushState({ ...(window.history.state ?? {}), hosLogoutMenu: true }, "", window.location.href);
    logoutMenuHistoryRef.current = true;
    const onPopState = () => {
      if (!logoutMenuHistoryRef.current) return;
      logoutMenuHistoryRef.current = false;
      setLogoutMenuOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!logoutMenuRef.current?.contains(event.target as Node)) closeLogoutMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLogoutMenu();
    };
    window.addEventListener("popstate", onPopState);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [logoutMenuOpen, closeLogoutMenu]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const saved = Number(window.localStorage.getItem(HOS_TOAST_DURATION_KEY));
        if (HOS_TOAST_DURATIONS.includes(saved as (typeof HOS_TOAST_DURATIONS)[number])) setToastDuration(saved);
      } catch { /* Keep the default when browser storage is unavailable. */ }
      setToastDurationLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!toastDurationLoaded) return;
    try { window.localStorage.setItem(HOS_TOAST_DURATION_KEY, String(toastDuration)); }
    catch { /* A storage failure must not affect HOS ordering. */ }
  }, [toastDuration, toastDurationLoaded]);

  useEffect(() => () => {
    if (successToastTimerRef.current !== null) window.clearTimeout(successToastTimerRef.current);
  }, []);

  useEffect(() => {
    if (screen !== "tables") return;
    const container = tableScreenRef.current;
    if (!container) return;
    let startY: number | null = null;
    let distance = 0;
    const pullThreshold = 64;
    const onTouchStart = (event: TouchEvent) => {
      const atPageTop = window.scrollY <= 0 && document.documentElement.scrollTop <= 0;
      if (!atPageTop || busy || event.touches.length !== 1) { startY = null; return; }
      startY = event.touches[0].clientY;
      distance = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startY === null || event.touches.length !== 1) return;
      if (window.scrollY > 0 || document.documentElement.scrollTop > 0) { startY = null; distance = 0; setPullDistance(0); return; }
      distance = Math.max(0, event.touches[0].clientY - startY);
      if (distance <= 0) { setPullDistance(0); return; }
      if (distance > 6 && event.cancelable) event.preventDefault();
      setPullDistance(Math.min(distance, pullThreshold));
    };
    const onTouchEnd = () => {
      const shouldRefresh = distance >= pullThreshold;
      startY = null;
      distance = 0;
      setPullDistance(0);
      if (shouldRefresh) void loadTables(true);
    };
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [busy, loadTables, screen]);

  useEffect(() => {
    if (screen === "tables") return;
    const container = mainRef.current;
    if (!container) return;
    let startX: number | null = null;
    let startY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { startX = null; startY = null; return; }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startX === null || startY === null || event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && menuListRef.current?.contains(target)) return;
      const touch = event.touches[0];
      const deltaY = touch.clientY - startY;
      if (deltaY <= 6 || deltaY <= Math.abs(touch.clientX - startX)) return;
      if (window.scrollY > 0 || document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) return;

      let element = event.target instanceof Element ? event.target : null;
      while (element && container.contains(element)) {
        const overflowY = window.getComputedStyle(element).overflowY;
        if (/(auto|scroll)/.test(overflowY) && element.scrollTop > 0) return;
        if (element === container) break;
        element = element.parentElement;
      }
      if (event.cancelable) event.preventDefault();
    };
    const resetTouch = () => { startX = null; startY = null; };
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", resetTouch, { passive: true });
    container.addEventListener("touchcancel", resetTouch, { passive: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", resetTouch);
      container.removeEventListener("touchcancel", resetTouch);
    };
  }, [screen]);

  const loadCatalog = useCallback(async () => {
    const result = await readJson<Catalog>(await fetchHos("/api/hos/menu-catalog", { cache: "no-store" }));
    setCatalog(result);
    return result;
  }, []);

  const refreshDetail = useCallback(async (tableId: number) => {
    if (activeDetailTableIdRef.current !== tableId) return;
    const requestVersion = ++detailRequestVersionRef.current;
    try {
      const response = await readJson<TableDetail>(await fetchHos(`/api/hos/tables/${tableId}`, { cache: "no-store" }));
      if (requestVersion !== detailRequestVersionRef.current || activeDetailTableIdRef.current !== tableId ||
        response.table.tableId !== tableId) return;
      setDetail(response);
    } catch (cause) {
      if (requestVersion === detailRequestVersionRef.current && activeDetailTableIdRef.current === tableId) {
        setError(cause instanceof Error ? cause.message : "주문 내역을 새로 고치지 못했습니다.");
      }
    }
  }, []);

  const activeTableId = detail?.table.tableId ?? null;
  const canManageCustomer = Boolean(detail?.session?.sessionId);
  const activeCustomerId = detail?.session?.customerId ?? null;
  const activeCustomerName = detail?.session?.customerName ?? null;
  const activeCustomer = activeCustomerId && activeCustomerName
    ? { customerId: activeCustomerId, name: activeCustomerName } : null;
  const customerLoading = customersLoadedKey !== (balanceView ? "balance" : "plain") && !customerError;
  const balanceCustomerId = balanceCustomer?.customerId ?? null;
  const tradeData = tradeDataState?.key === `${balanceCustomerId}:${tradePeriod}` ? tradeDataState.data : null;
  const tradeLoading = screen === "balance" && !tradeData && !customerError;
  const tradeDetail = tradeDetailState?.key === `${balanceCustomerId}:${selectedTrade?.ledgerId}` ? tradeDetailState.detail : null;
  useEffect(() => {
    if (screen !== "detail" || activeTableId === null) return;
    const tableId = activeTableId;
    const timer = window.setInterval(() => void refreshDetail(tableId), 5000);
    return () => window.clearInterval(timer);
  }, [activeTableId, refreshDetail, screen]);

  useEffect(() => {
    if (screen !== "customer") return;
    const controller = new AbortController();
    const key = balanceView ? "balance" : "plain";
    void fetchHos(`/api/hos/customers${balanceView ? "?includeBalance=1" : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as { success?: boolean; customers?: HosCustomer[]; message?: string };
        if (!response.ok || !result.success || !Array.isArray(result.customers)) throw new Error(result.message || "고객 목록을 불러오지 못했습니다.");
        if (!controller.signal.aborted) { setHosCustomers(result.customers); setCustomersLoadedKey(key); setCustomerError(""); }
      })
      .catch(cause => { if (!controller.signal.aborted) setCustomerError(cause instanceof Error ? cause.message : "고객 목록을 불러오지 못했습니다."); })
      .finally(() => undefined);
    return () => controller.abort();
  }, [balanceView, screen]);

  useEffect(() => {
    if (screen !== "balance" || !balanceCustomerId) return;
    const controller = new AbortController();
    const today = koreaToday();
    const range = tradePeriod === "all" ? null : tradePeriod === "month"
      ? { startDate: `${today.slice(0, 7)}-01`, endDate: today }
      : { startDate: shiftDate(today, tradePeriod === "90" ? -89 : -29), endDate: today };
    const query = new URLSearchParams();
    if (range) { query.set("startDate", range.startDate); query.set("endDate", range.endDate); }
    void fetchHos(`/api/customers/${balanceCustomerId}/ledger?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as CustomerTradeResponse;
        if (!response.ok || !result.success) throw new Error((result as CustomerTradeResponse & { message?: string }).message || "잔액 내역을 불러오지 못했습니다.");
        if (!controller.signal.aborted) { setTradeDataState({ key: `${balanceCustomerId}:${tradePeriod}`, data: result }); setCustomerError(""); }
      })
      .catch(cause => { if (!controller.signal.aborted) setCustomerError(cause instanceof Error ? cause.message : "잔액 내역을 불러오지 못했습니다."); })
      .finally(() => undefined);
    return () => controller.abort();
  }, [balanceCustomerId, screen, tradePeriod]);

  useEffect(() => {
    if (screen !== "tradeDetail" || !balanceCustomerId || !selectedTrade) return;
    const controller = new AbortController();
    void fetchHos(`/api/customers/${balanceCustomerId}/ledger/${selectedTrade.ledgerId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as CustomerTradeDetailResponse;
        if (!response.ok || !result.success || !result.detail) throw new Error(result.message || "거래 상세를 불러오지 못했습니다.");
        if (!controller.signal.aborted) { setTradeDetailState({ key: `${balanceCustomerId}:${selectedTrade.ledgerId}`, detail: result.detail }); setCustomerError(""); }
      })
      .catch(cause => { if (!controller.signal.aborted) setCustomerError(cause instanceof Error ? cause.message : "거래 상세를 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [balanceCustomerId, screen, selectedTrade]);

  async function openTable(table: TableRow) {
    const hasPendingChanges = draft.length > 0 || cancellations.length > 0;
    if (hasPendingChanges && pendingTableId !== table.tableId) {
      setError("미전송 주문 변경사항이 있습니다. 같은 테이블로 돌아가 주문완료하거나 취소해 주세요.");
      return;
    }
    const requestVersion = ++detailRequestVersionRef.current;
    activeDetailTableIdRef.current = table.tableId;
    setBusy(true); setError("");
    if (pendingTableId !== table.tableId) {
      setDraft([]); setCancellations([]); setCancelMode(false); setPendingTableId(null);
    }
    try {
      const response = await readJson<TableDetail>(await fetchHos(`/api/hos/tables/${table.tableId}`, { cache: "no-store" }));
      if (requestVersion !== detailRequestVersionRef.current || activeDetailTableIdRef.current !== table.tableId ||
        response.table.tableId !== table.tableId) return;
      setDetail(response); setScreen("detail");
    } catch (cause) {
      if (requestVersion === detailRequestVersionRef.current && activeDetailTableIdRef.current === table.tableId) {
        setError(cause instanceof Error ? cause.message : "주문 내역을 불러오지 못했습니다.");
      }
    }
    finally { if (requestVersion === detailRequestVersionRef.current) setBusy(false); }
  }

  async function openMenuPicker() {
    if (cancelMode) {
      setCancelMode(false);
      setCancellations([]);
      if (!draft.length) setPendingTableId(null);
    }
    try {
      const currentCatalog = catalog ?? await loadCatalog();
      const defaultCategory = currentCatalog.categories.find(category => menuCategoryDisplayName(category.name) === "찌개")
        ?? currentCatalog.categories[0];
      setError(""); setActiveCategoryId(defaultCategory?.categoryId ?? null); setScreen("menu");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "메뉴를 불러오지 못했습니다."); }
  }

  const removeCartFlight = useCallback((id: number) => {
    setCartFlights(current => current.filter(flight => flight.id !== id));
  }, []);

  function triggerCartFlight(origin: CartPoint | null) {
    if (!origin) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => {
      const target = cartSummaryRef.current;
      if (!target) return;

      const rect = target.getBoundingClientRect();
      const targetPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      if (!reduceMotion) {
        const id = ++cartFlightIdRef.current;
        setCartFlights(current => [...current, { id, ...origin, dx: targetPoint.x - origin.x, dy: targetPoint.y - origin.y }]);
      }

      cartPulseAnimationRef.current?.cancel();
      cartPulseAnimationRef.current = target.animate(reduceMotion ? [
        { backgroundColor: "transparent" }, { backgroundColor: "rgb(219 234 254)" }, { backgroundColor: "transparent" },
      ] : [
        { transform: "scale(1)" }, { transform: "scale(1.12)", offset: 0.45 }, { transform: "scale(1)" },
      ], { duration: reduceMotion ? 220 : 320, easing: "ease-out" });
    });
  }

  function chooseMenu(menu: Menu, keepMenuOpenAfterOption = false, originElement?: HTMLElement) {
    if (!catalog) return;
    optionAddLockRef.current = false;
    const modifiers = catalog.modifiers.filter(item => item.menuId === menu.menuId);
    const choice = getMenuChoice(modifiers);
    const defaults: Record<number, number> = {};
    const defaultOption = choice.title === "매운맛"
      ? choice.options.find(option => /^\s*2\s*[.)]\s*약간매운맛\s*$/.test(option.optionName)) ?? choice.selected
      : choice.selected;
    if (defaultOption) defaults[defaultOption.modifierGroupId] = defaultOption.modifierOptionId;
    keepMenuOpenAfterOptionRef.current = keepMenuOpenAfterOption;
    const originRect = originElement?.getBoundingClientRect();
    optionFlightOriginRef.current = originRect
      ? { x: originRect.left + originRect.width / 2, y: originRect.top + originRect.height / 2 }
      : null;
    setSelectedMenu(menu); setQuantity(1); setChoices(defaults); setError("");
  }

  function appendDraftItem(menu: Menu, qty: number, modifierOptionId: number | undefined, keepMenuOpen: boolean, origin: CartPoint | null = null) {
    if (!catalog) return;
    const selectedOptions = Number.isSafeInteger(modifierOptionId) ? [{ modifierOptionId: modifierOptionId!, qty: 1 }] : [];
    const components = catalog.components.filter(item => item.menuId === menu.menuId)
      .map(item => ({ menuComponentId: item.menuComponentId, qty: item.quantity * qty }));
    setDraft(current => {
      const sameOptions = (left: DraftItem["options"], right: DraftItem["options"]) =>
        left.length === right.length && left.every(option =>
          right.some(candidate => candidate.modifierOptionId === option.modifierOptionId && candidate.qty === option.qty));
      const existing = current.find(item => item.menuId === menu.menuId && sameOptions(item.options, selectedOptions));
      if (!existing) return [...current, { menuId: menu.menuId, name: menu.name, qty, options: selectedOptions, components }];

      const nextQty = existing.qty + qty;
      return current.map(item => item === existing ? {
        ...item,
        qty: nextQty,
        components: catalog.components.filter(component => component.menuId === menu.menuId)
          .map(component => ({ menuComponentId: component.menuComponentId, qty: component.quantity * nextQty })),
      } : item);
    });
    setPendingTableId(detail?.table.tableId ?? null);
    triggerCartFlight(origin);
    setSelectedMenu(null);
    if (!keepMenuOpen) setScreen("detail");
    setError("");
    keepMenuOpenAfterOptionRef.current = false;
  }

  function addDraft() {
    if (!catalog || !selectedMenu || optionAddLockRef.current) return;
    optionAddLockRef.current = true;
    const modifiers = catalog.modifiers.filter(item => item.menuId === selectedMenu.menuId);
    const choice = getMenuChoice(modifiers);
    const choiceId = choice.selected ? choices[choice.selected.modifierGroupId] : undefined;
    appendDraftItem(selectedMenu, quantity, choiceId, keepMenuOpenAfterOptionRef.current, optionFlightOriginRef.current);
    optionFlightOriginRef.current = null;
  }

  function quickAddMenu(menu: Menu, originElement: HTMLElement) {
    if (!catalog) return;
    const originRect = originElement.getBoundingClientRect();
    const origin = { x: originRect.left + originRect.width / 2, y: originRect.top + originRect.height / 2 };
    const modifiers = catalog.modifiers.filter(item => item.menuId === menu.menuId);
    const choice = getMenuChoice(modifiers);
    if (!choice.options.length) {
      appendDraftItem(menu, 1, undefined, true, origin);
      return;
    }

    const quickOption = choice.title === "매운맛"
      ? choice.options.find(option => /^\s*2\s*[.)]\s*약간매운맛\s*$/.test(option.optionName))
      : choice.options.find(option => option.choiceDefaultOptionId === option.modifierOptionId)
        ?? (choice.options.length === 1 ? choice.options[0] : undefined);
    if (!quickOption) {
      chooseMenu(menu, true, originElement);
      return;
    }
    appendDraftItem(menu, 1, quickOption.modifierOptionId, true, origin);
  }

  function changeKeepQuantity(item: OrderItem & { orderStatus: string }, delta: number) {
    if (!detail || !cancelMode || item.itemType === "COMPONENT" || item.effectiveQty <= 0 ||
      !["OPEN", "ACCEPTED"].includes(item.orderStatus)) return;
    const current = cancellations.find(row => row.orderItemId === item.orderItemId)?.keepQty ?? item.effectiveQty;
    const keepQty = clampHosRemainingQuantity(item.effectiveQty, current + delta);
    setCancellations(rows => {
      const withoutItem = rows.filter(row => row.orderItemId !== item.orderItemId);
      return keepQty === item.effectiveQty ? withoutItem : [...withoutItem, { orderItemId: item.orderItemId, keepQty }];
    });
    if (keepQty < item.effectiveQty || draft.length || cancellations.some(row =>
      row.orderItemId !== item.orderItemId && row.keepQty < (orderItems.find(orderItem => orderItem.orderItemId === row.orderItemId)?.effectiveQty ?? 0))) {
      setPendingTableId(detail.table.tableId);
    } else {
      setPendingTableId(null);
    }
    setError("");
  }

  function changeDraftQuantity(index: number, delta: number) {
    const nextQuantity = (draft[index]?.qty ?? 0) + delta;
    setDraft(rows => nextQuantity <= 0
      ? rows.filter((_, rowIndex) => rowIndex !== index)
      : rows.map((row, rowIndex) => rowIndex === index ? { ...row, qty: Math.min(1000, nextQuantity),
        components: row.components.map(component => {
          const menuComponent = catalog?.components.find(candidate => candidate.menuComponentId === component.menuComponentId);
          const unitQuantity = menuComponent?.quantity ?? component.qty / Math.max(1, row.qty);
          return { ...component, qty: unitQuantity * Math.min(1000, nextQuantity) };
        }) } : row));
    if (nextQuantity <= 0 && draft.length === 1 && !cancellations.length) setPendingTableId(null);
  }

  function showSuccessToast(message: string, position: "top" | "center" = "top") {
    if (successToastTimerRef.current !== null) window.clearTimeout(successToastTimerRef.current);
    setSuccessToast({ message, position });
    successToastTimerRef.current = window.setTimeout(() => {
      setSuccessToast(null);
      successToastTimerRef.current = null;
    }, toastDuration * 1000);
  }

  function clearDraftImmediately() {
    const tableId = detail?.table.tableId;
    const currentSignature = JSON.stringify(draft);
    if (tableId == null || !draft.length || busy || sendLock.current || clearDraftLockRef.current) return;
    clearDraftLockRef.current = true;
    try {
      if (detail?.table.tableId !== tableId || JSON.stringify(draft) !== currentSignature || busy || sendLock.current) return;
      setDraft([]);
      if (!cancellations.length) setPendingTableId(null);
      setError("");
      showSuccessToast("장바구니를 비웠습니다.", "center");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "장바구니를 비우지 못했습니다.");
    } finally {
      window.setTimeout(() => { clearDraftLockRef.current = false; }, 0);
    }
  }

  async function sendChanges(options?: { cancellationOverrides?: PendingCancel[]; orderItemsOverride?: Array<OrderItem & { orderStatus: string }>;
    currentSessionIdOverride?: number; keepDetailOpenAfterCancel?: boolean }) {
    const cancellationRows = options?.cancellationOverrides ?? cancellations;
    const cancellationSourceItems = options?.orderItemsOverride ?? orderItems;
    const cancellationRequests = cancellationRows.map(item => {
      const orderItem = cancellationSourceItems.find(candidate => candidate.orderItemId === item.orderItemId);
      return orderItem ? { orderItemId: item.orderItemId,
        qty: getHosCancellationQuantity(orderItem.effectiveQty, item.keepQty) } : null;
    }).filter((item): item is { orderItemId: number; qty: number } => item !== null && item.qty > 0);
    const submittingCancellations = cancelMode && cancellationRequests.length > 0;
    if (!detail || busy || sendLock.current || (cancelMode && !submittingCancellations) || (!cancelMode && !draft.length)) return;
    sendLock.current = true; setBusy(true); setError("");
    try {
      if (submittingCancellations) {
        const response = await fetchHos("/api/order-items/cancellations/batch", {
          method: "POST", headers: { "Content-Type": "application/json", "X-TDK-Program": "HOS" },
          body: JSON.stringify({ currentSessionId: options?.currentSessionIdOverride ?? detail.session?.sessionId,
            reason: cancellationReason, detail: cancellationDetail.trim(),
            cancellations: cancellationRequests }),
        });
        const result = await response.json().catch(() => null) as { success?: boolean; message?: string } | null;
        if (!response.ok || !result?.success) throw new Error(result?.message || `취소 전송에 실패했습니다. (HTTP ${response.status})`);
      } else {
        let sessionId = detail.session?.sessionId;
        if (!sessionId) {
          const created = await readJson<{ sessionId: number }>(await fetchHos("/api/table-sessions", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tableId: detail.table.tableId, personCount: 0, babyCount: 0 }),
          }));
          sessionId = created.sessionId;
          setDetail(current => current ? { ...current,
            session: { sessionId: created.sessionId, relatedSessionIds: [created.sessionId], customerId: null, customerName: null } } : current);
        }
        await readJson(await fetchHos(`/api/table-sessions/${sessionId}/orders`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: draft.map(item => ({ menuId: item.menuId, qty: item.qty, isComplimentary: false,
            options: item.options, components: item.components })) }),
        }));
      }
      if (submittingCancellations && options?.keepDetailOpenAfterCancel) {
        showSuccessToast("전체 주문을 취소했습니다.", "center");
        setCancellations([]);
        setCancelMode(false);
        setPendingTableId(draft.length ? detail.table.tableId : null);
        const tableId = detail.table.tableId;
        const requestVersion = ++detailRequestVersionRef.current;
        activeDetailTableIdRef.current = tableId;
        try {
          const latest = await readJson<TableDetail>(await fetchHos(`/api/hos/tables/${tableId}`, { cache: "no-store" }));
          if (requestVersion === detailRequestVersionRef.current && activeDetailTableIdRef.current === tableId && latest.table.tableId === tableId) {
            setDetail(latest);
            setScreen("detail");
            setError("");
          }
        } catch {
          if (requestVersion === detailRequestVersionRef.current && activeDetailTableIdRef.current === tableId) {
            setDetail(null);
            activeDetailTableIdRef.current = null;
            setScreen("tables");
            await loadTables();
            setError("취소는 완료됐지만 최신 주문내역을 불러오지 못했습니다. 테이블을 다시 열어 확인해 주세요.");
          }
        }
        return;
      }
      if (!submittingCancellations) setDraft([]);
      setCancellations([]); setPendingTableId(submittingCancellations && draft.length ? detail.table.tableId : null);
      detailRequestVersionRef.current += 1;
      activeDetailTableIdRef.current = null;
      setDetail(null); setScreen("tables");
      setCancelMode(false);
      await loadTables();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "변경 내용을 전송하지 못했습니다."); }
    finally { setBusy(false); sendLock.current = false; }
  }

  async function cancelAllExistingOrders() {
    if (!detail || !cancelMode || !cancellableItems.length || busy || sendLock.current || fullCancelLockRef.current) return;
    fullCancelLockRef.current = true;
    setBusy(true);
    setError("");
    const tableId = detail.table.tableId;
    try {
      const latest = await readJson<TableDetail>(await fetchHos(`/api/hos/tables/${tableId}`, { cache: "no-store" }));
      if (latest.table.tableId !== tableId || !latest.session?.sessionId || detail?.table.tableId !== tableId ||
        activeDetailTableIdRef.current !== tableId) {
        throw new Error("현재 테이블의 최신 주문을 확인할 수 없습니다. 화면을 새로 확인해 주세요.");
      }
      const latestOrderItems = latest.orders.flatMap(order => order.items
        .filter(item => item.itemType !== "COMPONENT" && item.effectiveQty > 0)
        .map(item => ({ ...item, orderStatus: order.status })));
      const latestCancellableItems = latestOrderItems.filter(item => ["OPEN", "ACCEPTED"].includes(item.orderStatus)
        && item.status !== "CANCELLED");
      if (!latestCancellableItems.length) {
        setDetail(latest);
        setCancellations([]);
        setCancelMode(false);
        setPendingTableId(draft.length ? tableId : null);
        setError("취소 가능한 기존 주문이 없습니다.");
        return;
      }
      const allCancellations = latestCancellableItems.map(item => ({ orderItemId: item.orderItemId, keepQty: 0 }));
      setDetail(latest);
      setCancellations(allCancellations);
      setPendingTableId(tableId);
      await sendChanges({ cancellationOverrides: allCancellations, orderItemsOverride: latestOrderItems,
        currentSessionIdOverride: latest.session.sessionId, keepDetailOpenAfterCancel: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "최신 주문을 확인하지 못해 전체취소를 진행하지 않았습니다.");
    } finally {
      fullCancelLockRef.current = false;
      setBusy(false);
    }
  }

  async function completeOrder() {
    if (!detail || busy || sendLock.current) return;
    const cancellationRequests = cancellations.map(item => {
      const orderItem = orderItems.find(candidate => candidate.orderItemId === item.orderItemId);
      return orderItem ? getHosCancellationQuantity(orderItem.effectiveQty, item.keepQty) : 0;
    });
    if (cancelMode && cancellationRequests.some(quantity => quantity > 0)) {
      await sendChanges();
      return;
    }
    if (!cancelMode && draft.length) {
      await sendChanges();
      return;
    }
    if (cancelMode) {
      setCancellations([]);
      setCancelMode(false);
      if (draft.length) return;
    }
    detailRequestVersionRef.current += 1;
    activeDetailTableIdRef.current = null;
    setCancelMode(false); setPendingTableId(null); setDetail(null); setScreen("tables"); setError("");
    await loadTables();
  }

  function returnToTables() {
    detailRequestVersionRef.current += 1;
    activeDetailTableIdRef.current = null;
    setDetail(null); setScreen("tables"); setError("");
    void loadTables();
  }

  function attemptAppExit() {
    setExitConfirmOpen(false);
    const isInstalledApp = window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(display-mode: fullscreen)").matches
      || ("standalone" in navigator && navigator.standalone === true);
    if (!isInstalledApp) {
      setExitMessage("일반 브라우저에서는 탭을 자동으로 닫지 않습니다. 브라우저의 탭 닫기 기능을 이용해 주세요.");
      return;
    }
    setExitMessage("앱 종료를 요청했습니다. 종료되지 않으면 화면 아래에서 위로 밀어 홈 화면으로 이동하거나 홈 버튼을 눌러 주세요.");
    try { window.close(); } catch { /* Keep the home-screen instructions visible when closing is unsupported. */ }
    window.setTimeout(() => {
      if (document.visibilityState === "visible") {
        setExitMessage("이 환경에서는 앱을 자동으로 닫을 수 없습니다. 화면 아래에서 위로 밀어 홈 화면으로 이동하거나 홈 버튼을 눌러 주세요.");
      }
    }, 700);
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetchHos("/api/hos/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("로그아웃하지 못했습니다. 다시 시도해 주세요.");
      router.replace("/tdkhos");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그아웃하지 못했습니다.");
    } finally { setBusy(false); }
  }

  const orderItems = (detail?.orders ?? []).flatMap(order => order.items
    .filter(item => item.itemType !== "COMPONENT" && item.effectiveQty > 0)
    .map(item => ({ ...item, orderStatus: order.status })));
  const confirmedOrderAmount = detail?.orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0) ?? 0;
  const draftQuantityTotal = draft.reduce((sum, item) => sum + item.qty, 0);
  const draftOrderAmount = draft.reduce((sum, item) => {
    const menu = catalog?.menus.find(candidate => candidate.menuId === item.menuId);
    const optionAmount = item.options.reduce((optionSum, option) => optionSum +
      Number(catalog?.modifiers.find(candidate => candidate.modifierOptionId === option.modifierOptionId)?.priceDelta ?? 0) * option.qty, 0);
    return sum + (Number(menu?.price ?? 0) + optionAmount) * item.qty;
  }, 0);
  const orderAmount = confirmedOrderAmount;
  const cancellableItems = orderItems.filter(item => ["OPEN", "ACCEPTED"].includes(item.orderStatus) && item.status !== "CANCELLED");
  const cancellationRequests = cancellations.map(item => {
    const orderItem = orderItems.find(candidate => candidate.orderItemId === item.orderItemId);
    return orderItem ? { orderItemId: item.orderItemId,
      qty: getHosCancellationQuantity(orderItem.effectiveQty, item.keepQty) } : null;
  }).filter((item): item is { orderItemId: number; qty: number } => item !== null && item.qty > 0);
  const menuSections = (catalog?.categories ?? []).map(category => ({ ...category,
    displayName: menuCategoryDisplayName(category.name),
    menus: (catalog?.menus ?? []).filter(menu => menu.categoryId === category.categoryId),
  }));
  const defaultMenuCategoryId = menuSections.find(category => category.displayName === "찌개")?.categoryId
    ?? menuSections[0]?.categoryId ?? null;
  const nonEmptyMenuSections = menuSections.filter(section => section.menus.length > 0);
  const categorizedMenuIds = new Set(nonEmptyMenuSections.flatMap(section => section.menus.map(menu => menu.menuId)));
  const uncategorizedMenus = (catalog?.menus ?? []).filter(menu => !categorizedMenuIds.has(menu.menuId));
  const menuSectionsForDisplay = [...nonEmptyMenuSections,
    ...(uncategorizedMenus.length ? [{ categoryId: -1, name: "", displayName: "", menus: uncategorizedMenus }] : [])];

  function cancelProgrammaticMenuScroll() {
    if (menuScrollAnimationRef.current !== null) {
      window.cancelAnimationFrame(menuScrollAnimationRef.current);
      menuScrollAnimationRef.current = null;
    }
    menuScrollTargetRef.current = null;
    programmaticMenuScrollRef.current = false;
  }

  function scrollToMenuCategory(categoryId: number | null) {
    setActiveCategoryId(categoryId);
    const list = menuListRef.current;
    if (!list) return;
    if (menuScrollAnimationRef.current !== null && menuScrollTargetRef.current === categoryId) return;
    const target = categoryId === null ? null : menuSectionRefs.current.get(categoryId);
    if (categoryId !== null && !target) return;

    cancelProgrammaticMenuScroll();
    const maxScrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    const requestedTop = target
      ? list.scrollTop + target.getBoundingClientRect().top - list.getBoundingClientRect().top
      : 0;
    const destination = Math.min(maxScrollTop, Math.max(0, requestedTop));
    const start = list.scrollTop;
    const distance = destination - start;
    if (Math.abs(distance) < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      list.scrollTop = destination;
      syncMenuCategoryFromScroll();
      return;
    }

    programmaticMenuScrollRef.current = true;
    menuScrollTargetRef.current = categoryId;
    let startedAt: number | null = null;
    const duration = Math.min(450, Math.max(120, Math.abs(distance) * 0.75));
    const animateScroll = (now: number) => {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      list.scrollTop = start + distance * eased;
      if (progress < 1) {
        menuScrollAnimationRef.current = window.requestAnimationFrame(animateScroll);
      } else {
        list.scrollTop = destination;
        menuScrollAnimationRef.current = null;
        programmaticMenuScrollRef.current = false;
        menuScrollTargetRef.current = null;
        syncMenuCategoryFromScroll();
      }
    };
    menuScrollAnimationRef.current = window.requestAnimationFrame(animateScroll);
  }

  function syncMenuCategoryFromScroll() {
    const list = menuListRef.current;
    if (!list || programmaticMenuScrollRef.current) return;
    if (list.scrollTop <= 1) {
      setActiveCategoryId(defaultMenuCategoryId);
      return;
    }
    const listTop = list.getBoundingClientRect().top;
    const positions = menuSectionsForDisplay.map(section => ({
      categoryId: section.categoryId,
      top: (menuSectionRefs.current.get(section.categoryId)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) - listTop,
    })).filter(section => Number.isFinite(section.top));
    const nextCategoryId = getHosMenuCategoryAtTop(positions, 8);
    setActiveCategoryId(nextCategoryId === -1 ? defaultMenuCategoryId : nextCategoryId);
  }

  useEffect(() => {
    if (screen !== "menu") return;
    const tabs = menuTabsRef.current;
    const activeTab = menuTabRefs.current.get(activeCategoryId);
    if (!tabs || !activeTab) return;
    const tabsRect = tabs.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    if (tabRect.left < tabsRect.left) tabs.scrollBy({ left: tabRect.left - tabsRect.left - 8, behavior: "smooth" });
    else if (tabRect.right > tabsRect.right) tabs.scrollBy({ left: tabRect.right - tabsRect.right + 8, behavior: "smooth" });
  }, [activeCategoryId, screen]);

  useEffect(() => {
    if (screen !== "menu") cancelProgrammaticMenuScroll();
  }, [screen]);

  async function chooseHosCustomer(customer: HosCustomer | null) {
    if (!detail || !detail.session || busy) {
      setCustomerError("고객을 연결하려면 영업 중인 테이블이어야 합니다.");
      return;
    }
    setBusy(true);
    setCustomerError("");
    try {
      const response = await fetchHos(`/api/hos/tables/${detail.table.tableId}/customer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: customer?.customerId ?? null }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || "고객 연결을 저장하지 못했습니다.");
      setScreen("detail");
      await refreshDetail(detail.table.tableId);
      void loadTables();
    } catch (cause) {
      setCustomerError(cause instanceof Error ? cause.message : "고객 연결을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  function openTradeEntry(entry: CustomerTradeRow) {
    setSelectedTrade(entry);
    setCustomerError("");
    setScreen("tradeDetail");
  }

  useEffect(() => () => {
    if (menuScrollAnimationRef.current !== null) window.cancelAnimationFrame(menuScrollAnimationRef.current);
  }, []);

  useEffect(() => () => cartPulseAnimationRef.current?.cancel(), []);

  return <main className={`flex flex-col bg-white pb-[env(safe-area-inset-bottom)] text-slate-900 ${screen === "menu" ? "h-dvh overflow-hidden" : "min-h-dvh"}`} ref={mainRef}>
    {screen === "tables" ? <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 pb-1 pt-[19px] text-slate-900">
      <div className="flex min-w-0 flex-col items-start leading-tight">
        <button aria-label="TDK HOS 앱 종료" className="bg-transparent p-0 text-left" onClick={() => { setExitMessage(""); setExitConfirmOpen(true); }} type="button"><strong className="shrink-0 text-lg font-extrabold text-[#2563EB]">TDK HOS</strong></button>
        <span className="mt-0.5 max-w-full break-all text-xs leading-tight text-slate-400">{staffLoginId ?? ""}</span>
      </div>
      <div className="relative shrink-0" ref={logoutMenuRef}>
        <button aria-expanded={logoutMenuOpen} aria-haspopup="menu" aria-label="메뉴" className="flex min-h-11 min-w-11 items-center justify-center bg-transparent p-0 text-2xl leading-none text-slate-600" disabled={busy} onClick={() => logoutMenuOpen ? closeLogoutMenu() : setLogoutMenuOpen(true)} type="button">⋮</button>
        {logoutMenuOpen && <div className="absolute right-0 top-full z-30 mt-1 min-w-32 rounded-lg border border-slate-200 bg-white py-1 shadow-lg" role="menu">
          <button className="min-h-11 w-full px-4 text-left text-sm font-medium text-slate-700" onClick={() => { closeLogoutMenu(); setSettingsOpen(true); }} role="menuitem" type="button">설정</button>
          <button className="min-h-11 w-full px-4 text-left text-sm font-medium text-slate-700" onClick={() => { closeLogoutMenu(); void logout(); }} role="menuitem" type="button">로그아웃</button>
        </div>}
      </div>
    </header> : screen === "detail" ? <header className="sticky top-0 z-20 bg-white px-3 pt-[15px] text-slate-900">
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-200">
        <button aria-label="테이블 배치로 돌아가기" className="flex min-h-11 min-w-0 shrink items-center gap-1.5 bg-transparent pr-1 text-2xl font-bold text-slate-700" onClick={returnToTables} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>주문</span></button>
        <div className="flex shrink-0 items-center gap-1">
          {canManageCustomer && <button aria-label={activeCustomer ? `${activeCustomer.name} 고객 변경` : "고객 선택"} className="min-h-11 max-w-[34vw] min-w-8 truncate bg-transparent px-1 text-right text-sm font-semibold text-blue-700" disabled={busy} onClick={() => { setCustomerError(""); setBalanceView(false); setManagedCustomersOnly(true); setScreen("customer"); }} title={activeCustomer?.name ?? "고객"} type="button">{activeCustomer?.name ?? "고객"}</button>}
          {draft.length > 0 && <button aria-label="장바구니 비우기" className="min-h-11 shrink-0 whitespace-nowrap bg-transparent px-1 text-[12px] font-semibold text-red-600 active:text-red-800 disabled:opacity-50" disabled={busy} onClick={clearDraftImmediately} type="button">장바구니 비우기</button>}
        </div>
      </div>
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-slate-200 py-1">
        <span className="text-[17px] font-normal text-slate-500">T.<strong className="ml-1 font-extrabold text-slate-900">{detail?.table.tableNo}</strong></span>
        <strong className="text-right text-[17px] font-extrabold text-slate-900">{money(orderAmount)}</strong>
      </div>
    </header> : screen === "customer" ? <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 pt-[15px]">
      <button aria-label="주문 화면으로 돌아가기" className="flex min-h-11 min-w-11 items-center gap-1.5 bg-transparent pr-2 text-2xl font-bold text-slate-700" onClick={() => setScreen("detail")} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>고객</span></button>
    </header> : screen === "balance" ? <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-1 border-b border-slate-200 bg-white px-2 pt-[15px]">
      <button aria-label="고객 목록으로 돌아가기" className="flex min-h-11 min-w-11 shrink-0 items-center gap-1 bg-transparent pr-1 text-xl font-bold text-slate-700" onClick={() => { setCustomerError(""); setScreen("customer"); }} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>잔액관리</span></button>
      <div aria-label="거래 조회기간" className="flex min-w-0 gap-1" role="group">{([ ["all", "전부"], ["90", "90"], ["30", "30"], ["month", "당월"] ] as const).map(([period, label]) => <button aria-pressed={tradePeriod === period} className={`min-h-9 min-w-9 rounded-lg px-2 text-xs font-bold ${tradePeriod === period ? "bg-blue-700 text-white" : "bg-blue-50 text-blue-700"}`} key={period} onClick={() => { setTradePeriod(period); setCustomerError(""); }} type="button">{label}</button>)}</div>
    </header> : screen === "tradeDetail" ? <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 pt-[15px]">
      <button aria-label="잔액관리로 돌아가기" className="flex min-h-11 items-center gap-1.5 bg-transparent pr-2 text-xl font-bold text-slate-700" onClick={() => { setCustomerError(""); setScreen("balance"); }} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>거래 상세</span></button>
    </header> : <header className="sticky top-0 z-20 shrink-0 bg-white px-3 pt-[15px] text-slate-900">
      <div className="flex min-h-12 items-center justify-between gap-2 border-b border-slate-200">
        <button aria-label={"\uC8FC\uBB38\uB0B4\uC5ED\uC73C\uB85C \uB3CC\uC544\uAC00\uAE30"} className="flex min-h-11 min-w-0 items-center gap-1.5 bg-transparent pr-2 text-2xl font-bold text-slate-700" onClick={() => setScreen("detail")} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>{"\uBA54\uB274\uC120\uD0DD"}</span></button>
        <span className="inline-block shrink-0 whitespace-nowrap text-[17px] font-semibold text-slate-600" ref={cartSummaryRef}>{draft.length > 0 ? <>{"\uC7A5\uBC14\uAD6C\uB2C8"} {draft.length}/{draftQuantityTotal}</> : "\uC7A5\uBC14\uAD6C\uB2C8"}</span>
      </div>
    </header>}
    {error && <div className={`mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 ${screen === "detail" ? "text-[17px]" : "text-sm"} font-semibold text-red-700`} role="alert">{error}</div>}

    {customerError && <div className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{customerError}</div>}
    {screen === "customer" && <section className="flex min-h-0 flex-1 flex-col">
      <div aria-label="고객 목록" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2" role="listbox">
        {customerLoading && !hosCustomers.length ? <p className="py-8 text-center text-sm text-slate-500">고객 목록을 불러오는 중입니다.</p>
          : !customerLoading && !customerError && hosCustomers.filter(customer => !managedCustomersOnly || customer.isPaymentManaged).length === 0
            ? <p className="py-8 text-center text-sm text-slate-500">표시할 고객이 없습니다.</p>
            : hosCustomers.filter(customer => !managedCustomersOnly || customer.isPaymentManaged).map(customer => <article className="mb-2 flex min-h-14 items-center gap-2" key={customer.customerId}>
              <button aria-selected={activeCustomer?.customerId === customer.customerId} className={`flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border px-3 text-left ${activeCustomer?.customerId === customer.customerId ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-800"}`} disabled={busy} onClick={() => void chooseHosCustomer(activeCustomer?.customerId === customer.customerId ? null : customer)} role="option" type="button">
                <span className="min-w-0 truncate font-semibold">{customer.name}</span>
                {balanceView && customer.isPaymentManaged && <span className="shrink-0 text-sm font-semibold text-slate-600">{formatTradeBalance(customer.tradeBalance ?? 0)}</span>}
              </button>
              {balanceView && customer.isPaymentManaged && <button aria-label={`${customer.name} 잔액관리`} className="min-h-11 shrink-0 rounded-lg bg-blue-50 px-3 text-xs font-bold text-blue-700" onClick={() => { setCustomerError(""); setBalanceCustomer({ customerId: customer.customerId, name: customer.name }); setScreen("balance"); }} type="button">내역</button>}
            </article>)}
        {customerLoading && hosCustomers.length > 0 && <p className="py-2 text-center text-xs text-slate-400">고객 정보를 갱신하고 있습니다.</p>}
      </div>
      <div className="sticky bottom-0 border-t border-slate-200 bg-white px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-2 gap-2">
          <button aria-checked={balanceView} className="flex min-h-12 min-w-0 items-center justify-between gap-1 rounded-xl bg-slate-50 px-2 text-left text-xs font-semibold text-slate-700" onClick={() => setBalanceView(value => !value)} role="switch" type="button"><span className="whitespace-nowrap">잔액보기</span><span aria-hidden="true" className={"relative h-7 w-12 shrink-0 rounded-full transition-colors " + (balanceView ? "bg-blue-700" : "bg-slate-300")}><span className={"absolute top-1 size-5 rounded-full bg-white shadow transition-transform " + (balanceView ? "translate-x-6" : "translate-x-1")} /></span></button>
          <button aria-checked={managedCustomersOnly} className="flex min-h-12 min-w-0 items-center justify-between gap-1 rounded-xl bg-slate-50 px-2 text-left text-xs font-semibold text-slate-700" onClick={() => setManagedCustomersOnly(value => !value)} role="switch" type="button"><span className="whitespace-nowrap">선불관리</span><span aria-hidden="true" className={"relative h-8 w-14 shrink-0 rounded-full transition-colors " + (managedCustomersOnly ? "bg-blue-700" : "bg-slate-300")}><span className={"absolute top-1 size-6 rounded-full bg-white shadow transition-transform " + (managedCustomersOnly ? "translate-x-7" : "translate-x-1")} /><span className={"absolute top-0 flex h-full items-center text-[9px] font-bold " + (managedCustomersOnly ? "left-1.5 text-white" : "right-1.5 text-slate-600")}>{managedCustomersOnly ? "ON" : "OFF"}</span></span></button>
        </div>
      </div>
    </section>}

    {(screen === "balance" || screen === "tradeDetail") && <>
      <section aria-label="고객 잔액관리" className={`flex min-h-0 flex-1 flex-col ${screen === "tradeDetail" ? "hidden" : ""}`}>
        <div className="shrink-0 border-b border-slate-100 px-4 py-3">
          <div className="truncate text-sm font-semibold text-slate-600">{balanceCustomer?.name ?? "고객"}</div>
          <div className="mt-1 flex items-center justify-between gap-3"><span className="text-sm text-slate-500">현재 잔액</span><strong className="text-lg font-extrabold text-blue-700">{formatTradeBalance(tradeData?.balance ?? 0)}</strong></div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {tradeLoading ? <p className="py-8 text-center text-sm text-slate-500">거래내역을 불러오는 중입니다.</p>
            : tradeData?.entries?.length ? tradeData.entries.filter(entry => !tradeData.hideableLedgerIds?.includes(entry.ledgerId)).map(entry => <button className="mb-2 flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left" key={entry.ledgerId} onClick={() => openTradeEntry(entry)} type="button">
              <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{tradeDescription(entry)}</span><time className="mt-1 block text-xs text-slate-500" dateTime={entry.transactionAt}>{entry.transactionAt.replace("T", " ").slice(0, 16)}</time></span>
              <span className="shrink-0 text-right"><strong className={`block text-sm ${entry.amount < 0 ? "text-red-600" : "text-blue-700"}`}>{formatTradeBalance(entry.amount)}</strong><span className="block text-[11px] text-slate-500">잔액 {formatTradeBalance(entry.balance)}</span></span>
            </button>) : !customerError && <p className="py-8 text-center text-sm text-slate-500">거래내역이 없습니다.</p>}
        </div>
      </section>
      {screen === "tradeDetail" && <section aria-label="거래 상세" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {tradeLoading || (!tradeDetail && !customerError) ? <p className="py-8 text-center text-sm text-slate-500">거래 상세를 불러오는 중입니다.</p> : tradeDetail && <>
          <div className="mb-3 rounded-xl bg-slate-50 p-3"><time className="block text-sm font-semibold" dateTime={tradeDetail.entry.transactionAt}>{tradeDetail.entry.transactionAt.replace("T", " ").slice(0, 16)}</time><p className="mt-1 text-sm text-slate-600">{tradeDetail.customerName} · {tradeDetail.checkout?.place ?? "테이블 정보 없음"}</p><p className="mt-2 text-sm font-semibold">{tradeTypeLabel(tradeDetail.entry.entryType)} <strong className="ml-2">{money(Math.abs(tradeDetail.entry.amount))}원</strong></p></div>
          {tradeDetail.checkout && <section className="mb-3 rounded-xl border border-slate-200 p-3"><h2 className="mb-2 text-sm font-bold">주문 메뉴</h2>
            {tradeDetail.checkout.items.map(item => <div className="border-b border-slate-100 py-2 last:border-0" key={item.checkoutItemId}><div className="flex items-start justify-between gap-2 text-sm"><span className="min-w-0 truncate font-medium">{item.name}</span><span className="shrink-0">{item.qty} × {money(item.unitPrice)}원</span><strong className="shrink-0">{money(item.amount)}원</strong></div>{item.options.length > 0 && <p className="mt-1 text-xs text-slate-500">{item.options.join(" · ")}</p>}</div>)}
            <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm"><span>결제 대상 합계</span><strong>{money(tradeDetail.checkout.totalAmount)}원</strong></div>
          </section>}
          {tradeDetail.payment && <section className="mb-3 rounded-xl border border-slate-200 p-3"><h2 className="mb-2 text-sm font-bold">결제 내역</h2><div className="flex justify-between gap-3 text-sm"><span>{tradeDetail.payment.methodName}</span><strong>{money(tradeDetail.payment.appliedAmount)}원</strong></div><p className="mt-1 text-xs text-slate-500">상태: {tradeDetail.payment.status}</p></section>}
          <section className="rounded-xl border border-slate-200 p-3"><h2 className="mb-2 text-sm font-bold">고객 잔액 거래</h2><div className="flex justify-between text-sm"><span>거래 전 잔액</span><strong>{formatTradeBalance(tradeDetail.balanceBefore)}</strong></div><div className="mt-1 flex justify-between text-sm"><span>거래 금액</span><strong>{formatTradeBalance(tradeDetail.entry.amount)}</strong></div><div className="mt-1 flex justify-between text-sm"><span>거래 후 잔액</span><strong>{formatTradeBalance(tradeDetail.entry.balance)}</strong></div>{tradeDetail.entry.memo && <p className="mt-2 break-words text-xs text-slate-500">{tradeDetail.entry.memo}</p>}</section>
        </>}
      </section>}
    </>}

    {screen === "tables" && <section className="relative overscroll-y-contain p-3" ref={tableScreenRef}>
      <div aria-live="polite" className={`flex items-center justify-center gap-2 overflow-hidden text-xs text-slate-500 transition-[height] ${manualRefreshing || pullDistance > 0 ? "h-8" : "h-0"}`}>
        {manualRefreshing ? <><span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />테이블 정보 갱신 중</>
          : pullDistance > 0 && <span>{pullDistance >= 64 ? "놓으면 갱신" : "아래로 당겨 갱신"}</span>}
      </div>
      {tables.length > 0
        ? <HosTableCanvas tables={tables} dividerPositions={dividerPositions} disabled={busy} onSelect={table => {
          const destination = table.isMergedSource
            ? tables.find(candidate => candidate.tableNo === table.mergedIntoTableNo) : null;
          void openTable(destination ?? table);
        }} />
        : !refreshing && <p className="mx-auto grid min-h-40 max-w-[900px] place-items-center rounded-xl border border-slate-300 bg-white text-sm text-slate-500">사용 가능한 테이블이 없습니다.</p>}
      <p className="mt-2 text-center text-xs text-slate-500">QR 주문 승인 기능은 아직 연결되어 있지 않습니다.</p>
    </section>}

    {screen === "detail" && detail && <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col p-3">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
        {orderItems.length > 0 && <>
        <section aria-labelledby="confirmed-orders-title">
          <h2 className="mb-2 text-[17px] font-bold text-slate-500" id="confirmed-orders-title">기존 주문내역</h2>
          {orderItems.length ? <div className="divide-y divide-slate-100">
            {orderItems.map(item => {
              const pending = cancellations.find(row => row.orderItemId === item.orderItemId);
              const keepQty = pending?.keepQty ?? item.effectiveQty;
              const canCancel = cancelMode && ["OPEN", "ACCEPTED"].includes(item.orderStatus) && item.status !== "CANCELLED";
              const displayQty = cancelMode && canCancel ? keepQty : item.effectiveQty;
              const itemAmount = Number(item.unitPrice || 0) * displayQty;
              const optionNames = item.options.map(option => option.optionName);
              return <article className={`py-3 ${pending && keepQty < item.effectiveQty ? "bg-red-50" : ""}`} key={item.orderItemId}>
                <div className="grid grid-cols-[minmax(0,1fr)_7rem_4.5rem] items-center gap-x-2">
                  <strong className="min-w-0 truncate text-lg font-bold text-slate-900" title={item.itemName}>{item.itemName}</strong>
                  <div aria-label={`${item.itemName} 남길 수량`} className="flex w-28 items-center justify-center gap-1.5">
                    <button aria-label={`${item.itemName} 남길 수량 감소`} aria-hidden={!canCancel} className={`size-9 shrink-0 rounded-lg bg-slate-100 text-[21px] font-bold disabled:opacity-40 ${canCancel ? "" : "invisible"}`} disabled={!canCancel || keepQty <= 0} onClick={() => changeKeepQuantity(item, -1)} tabIndex={canCancel ? 0 : -1} type="button">−</button>
                    <strong className="min-w-5 text-center text-[17px]">{money(displayQty)}</strong>
                    <button aria-label={`${item.itemName} 남길 수량 증가`} aria-hidden={!canCancel} className={`size-9 shrink-0 rounded-lg bg-slate-100 text-[21px] font-bold disabled:opacity-40 ${canCancel ? "" : "invisible"}`} disabled={!canCancel || keepQty >= item.effectiveQty} onClick={() => changeKeepQuantity(item, 1)} tabIndex={canCancel ? 0 : -1} type="button">+</button>
                  </div>
                  <strong className="min-w-[4.5rem] text-right text-[17px] font-semibold text-slate-800">{money(itemAmount)}</strong>
                </div>
                {optionNames.length > 0 && <p className="mt-0.5 break-words text-[13px] leading-tight text-slate-400">{optionNames.join(" · ")}</p>}
                {pending && keepQty < item.effectiveQty && <p className="mt-0.5 text-[13px] font-medium text-red-600">{item.effectiveQty - keepQty}개 취소 예정</p>}
                {cancelMode && !canCancel && <p className="mt-0.5 text-[13px] text-slate-400">취소 불가</p>}
              </article>;
            })}
          </div> : <p className="py-3 text-[17px] text-slate-400">확정된 주문이 없습니다.</p>}
          {cancelMode && cancellationRequests.length > 0 && <div className="mt-2 rounded-lg bg-slate-50 p-3">
            <label className="block text-[17px] font-bold text-slate-700">취소 사유
              <select className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-[19px]" onChange={event => setCancellationReason(event.target.value)} value={cancellationReason}>
                {["고객 요청", "주문 실수", "조리 불량", "이물질", "에러", "기타"].map(reason => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            {cancellationReason === "기타" && <input className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-[19px]" onChange={event => setCancellationDetail(event.target.value)} placeholder="취소 사유를 입력해 주세요" value={cancellationDetail} />}
          </div>}
        </section>

        <div aria-hidden="true" className="my-4 h-[2px] w-full bg-[#D9DEE5]" />
        </>}

        <section aria-labelledby="cart-title">
          <div className="mb-2 flex min-w-0 items-center justify-between gap-3">
            <h2 className="text-[17px] font-bold text-slate-700" id="cart-title">장바구니</h2>
            {draft.length > 0 && <span className="shrink-0 whitespace-nowrap text-right text-[15px] text-slate-500">합계 {money(draftOrderAmount)}</span>}
          </div>
          {draft.length ? <div className="divide-y divide-slate-100">
            {draft.map((item, index) => {
              const menu = catalog?.menus.find(candidate => candidate.menuId === item.menuId);
              const optionAmount = item.options.reduce((sum, option) => sum + Number(catalog?.modifiers.find(candidate => candidate.modifierOptionId === option.modifierOptionId)?.priceDelta ?? 0) * option.qty, 0);
              const itemAmount = (Number(menu?.price ?? 0) + optionAmount) * item.qty;
              const optionNames = item.options.map(option => catalog?.modifiers.find(candidate => candidate.modifierOptionId === option.modifierOptionId)?.optionName).filter(Boolean);
              return <article className="py-3" key={`${item.menuId}-${index}`}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="inline-flex shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[13px] font-bold text-blue-700">신규</span>
                    <strong className="min-w-0 truncate text-lg font-bold" title={item.name}>{item.name}</strong>
                  </div>
                  <div className="flex items-center gap-1">
                    <button aria-label={`${item.name} 장바구니 수량 감소`} className="size-9 rounded-lg bg-slate-100 text-[21px] font-bold" onClick={() => changeDraftQuantity(index, -1)} type="button">−</button>
                    <strong className="min-w-5 text-center text-[17px]">{money(item.qty)}</strong>
                    <button aria-label={`${item.name} 장바구니 수량 증가`} className="size-9 rounded-lg bg-slate-100 text-[21px] font-bold" disabled={item.qty >= 1000} onClick={() => changeDraftQuantity(index, 1)} type="button">+</button>
                  </div>
                  <strong className="min-w-[4.5rem] text-right text-[17px] font-semibold">{money(itemAmount)}</strong>
                </div>
                {optionNames.length > 0 && <p className="mt-0.5 break-words text-[13px] leading-tight text-slate-400">{optionNames.join(" · ")}</p>}
              </article>;
            })}
          </div> : <p className="rounded-lg bg-slate-50 px-3 py-4 text-[17px] text-slate-400">추가한 메뉴가 없습니다.</p>}
        </section>
      </div>
      <div className="sticky bottom-0 border-t border-slate-200 bg-white/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-[4fr_3fr_3fr] items-end gap-2">
        <button className={`min-h-14 rounded-xl text-[17px] font-extrabold disabled:opacity-50 ${cancelMode ? "bg-[#EAF2FF] text-[#1855DF]" : "bg-blue-700 text-white"}`} disabled={busy} onClick={() => void openMenuPicker()} type="button">추가</button>
        <button className="min-h-14 rounded-xl border border-violet-500 bg-violet-50 text-[17px] font-extrabold text-violet-700 disabled:opacity-50" disabled={busy} onClick={() => void completeOrder()} type="button">전송</button>
        <div className="grid min-w-0 gap-2">
        {cancelMode && cancellableItems.length > 0 && <button className="min-h-14 rounded-xl border border-red-200 bg-[#FFF0F0] text-[17px] font-extrabold text-[#DC2626] disabled:opacity-50" disabled={busy || !cancellableItems.length} onClick={() => void cancelAllExistingOrders()} type="button">전체취소</button>}
        <button className={`min-h-14 rounded-xl border text-[17px] font-extrabold ${cancelMode ? "border-[#E60012] bg-[#E60012] text-white" : "border-red-500 bg-red-50 text-red-700"}`} disabled={busy || (!cancelMode && !cancellableItems.length)} onClick={() => {
          if (cancelMode) {
            setCancelMode(false); setCancellations([]);
            if (!draft.length) setPendingTableId(null);
          } else {
            setCancellations([]); setCancelMode(true);
            if (detail) setPendingTableId(detail.table.tableId);
          }
          setError("");
        }} type="button">취소</button>
        </div>
        </div>
      </div>
    </section>}

    {screen === "menu" && catalog && <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden px-3 pb-3">
      <div aria-label="메뉴 분류" className="-mx-3 grid shrink-0 grid-cols-5 gap-2 border-b border-slate-100 bg-white px-3 py-2" ref={menuTabsRef}>
        {menuSections.map(item => <button className={`min-h-11 w-full min-w-0 whitespace-nowrap rounded-full px-1 text-[17px] font-bold ${activeCategoryId === item.categoryId ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} key={item.categoryId} onClick={() => scrollToMenuCategory(item.categoryId)} ref={element => {
          if (element) menuTabRefs.current.set(item.categoryId, element); else menuTabRefs.current.delete(item.categoryId);
        }} type="button">{item.displayName}</button>)}
      </div>
      <div className="-mx-3 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" onPointerDown={cancelProgrammaticMenuScroll} onScroll={syncMenuCategoryFromScroll} onTouchStart={cancelProgrammaticMenuScroll} onWheel={cancelProgrammaticMenuScroll} ref={menuListRef} style={{ WebkitOverflowScrolling: "touch" }}>
        {menuSectionsForDisplay.map(section => <div className="-mx-3 mb-[11.2px] border-y border-[#e5ebf0] bg-[#fbfcfe] px-3 shadow-[0_1px_3px_rgba(71,85,105,0.08)] last:mb-0" data-menu-category-section={section.categoryId} key={section.categoryId} ref={element => {
          if (element) menuSectionRefs.current.set(section.categoryId, element); else menuSectionRefs.current.delete(section.categoryId);
        }}>
          {section.menus.map(menu => <div className="flex min-h-14 w-full items-center border-b border-slate-100 last:border-b-0" key={menu.menuId}>
            <button className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 bg-transparent px-1 py-3 text-left active:bg-blue-50" onClick={event => chooseMenu(menu, true, event.currentTarget)} type="button"><span className="flex min-w-0 flex-1 items-baseline gap-1 whitespace-nowrap"><span className="max-w-full shrink-0 truncate text-[19px] font-bold">{menu.name}</span>{section.name === "김치찌개" && <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-400" title="2.약간매운맛">2.약간매운맛</span>}</span><span className="shrink-0 whitespace-nowrap text-[17px] font-semibold text-slate-600">{money(Number(menu.price))}</span></button>
            <button aria-label={`${menu.name} 장바구니에 1개 추가`} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center bg-transparent text-blue-600 active:text-blue-800" onClick={event => quickAddMenu(menu, event.currentTarget)} type="button"><svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 1.9-1.4L21 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg></button>
          </div>)}
        </div>)}
      </div>
      <div className="sticky bottom-0 bg-white py-2"><button className="min-h-14 w-full rounded-xl bg-[#1D5EFF] font-extrabold text-white transition-colors hover:bg-[#164edb] active:bg-[#1245c6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D5EFF]" onClick={() => setScreen("detail")} type="button">장바구니로 돌아가기</button></div>
    </section>}

    {selectedMenu && catalog && <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/50 p-2 sm:items-center" onClick={() => { optionAddLockRef.current = false; optionFlightOriginRef.current = null; setSelectedMenu(null); }}>
      <section aria-modal="true" className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="dialog">
        <div className="flex min-w-0 items-center justify-between gap-3"><h2 className="min-w-0 truncate text-xl font-extrabold" title={selectedMenu.name}>{selectedMenu.name}</h2><p className="shrink-0 whitespace-nowrap text-lg font-semibold text-slate-600">{money(Number(selectedMenu.price))}</p></div>
        {(() => {
          const choice = getMenuChoice(catalog.modifiers.filter(item => item.menuId === selectedMenu.menuId));
          return choice.options.length > 0 && <fieldset className="mt-4 min-w-0"><legend className="mb-2 text-left text-sm font-bold">{choice.title}</legend><div className="grid min-w-0 grid-cols-4 gap-2">{choice.options.map(option => {
            const label = `${option.optionName}${Number(option.priceDelta) ? ` (${money(Number(option.priceDelta))})` : ""}`;
            return <button aria-label={label} className={`min-h-12 w-full min-w-0 overflow-hidden rounded-lg px-1 text-sm font-bold ${choices[option.modifierGroupId] === option.modifierOptionId ? "bg-blue-600 text-white" : "bg-slate-100"}`} key={option.modifierOptionId} onClick={() => setChoices(current => ({ ...current, [option.modifierGroupId]: option.modifierOptionId }))} title={label} type="button"><span className="block truncate whitespace-nowrap">{label}</span></button>;
          })}</div></fieldset>;
        })()}
        <div className="mt-5 flex min-h-[72px] items-center justify-center gap-6"><button className="size-[72px] shrink-0 rounded-xl bg-slate-100 text-4xl" onClick={() => setQuantity(value => Math.max(1, value - 1))} type="button">−</button><strong className="min-w-[2ch] text-center text-[30px] tabular-nums">{quantity}</strong><button className="size-[72px] shrink-0 rounded-xl bg-slate-100 text-4xl" onClick={() => setQuantity(value => Math.min(1000, value + 1))} type="button">+</button></div>
        <div className="mt-5 grid grid-cols-[7fr_3fr] gap-2"><button className="min-h-12 min-w-0 whitespace-nowrap rounded-xl bg-blue-600 px-1 text-sm font-extrabold text-white" onClick={addDraft} type="button">장바구니에 담기</button><button className="min-h-12 min-w-0 whitespace-nowrap rounded-xl bg-slate-100 px-1 text-sm font-bold text-slate-900" onClick={() => { optionAddLockRef.current = false; optionFlightOriginRef.current = null; setSelectedMenu(null); }} type="button">취소</button></div>
      </section>
    </div>}
    {typeof document !== "undefined" && cartFlights.length > 0 && createPortal(
      cartFlights.map(flight => <FlyingCart active={screen === "menu"} flight={flight} key={flight.id} onComplete={removeCartFlight} />),
      document.body,
    )}
    {exitConfirmOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
      <section aria-labelledby="hos-exit-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" role="alertdialog">
        <h2 className="text-lg font-extrabold" id="hos-exit-title">종료하시겠습니까?</h2>
        {draft.length > 0 || cancellations.length > 0 || busy
          ? <p className="mt-2 text-sm leading-relaxed text-amber-700">{busy ? "처리 중인 요청이 있습니다. 완료 전에 종료하면 결과가 반영되지 않을 수 있습니다. " : ""}{draft.length > 0 ? "미전송 주문이 있습니다. " : ""}{cancellations.length > 0 ? "저장하지 않은 취소 변경이 있습니다. " : ""}앱을 종료하면 미전송 변경사항이 사라질 수 있습니다.</p>
          : <p className="mt-2 text-sm text-slate-600">TDK HOS 앱을 종료합니다.</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button autoFocus className="min-h-12 rounded-xl bg-slate-100 font-bold text-slate-700" onClick={() => setExitConfirmOpen(false)} type="button">취소</button>
          <button className="min-h-12 rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50" disabled={busy} onClick={attemptAppExit} type="button">종료</button>
        </div>
      </section>
    </div>}
    {successToast && <div aria-live="polite" className={`pointer-events-none fixed z-[90] flex px-4 ${successToast.position === "center" ? "inset-0 items-center justify-center" : "inset-x-0 top-[calc(env(safe-area-inset-top)+1rem)] justify-center"}`} role="status">
      <div className="rounded-full bg-slate-800/95 px-4 py-2 text-sm font-semibold text-white shadow-lg">{successToast.message}</div>
    </div>}
    {settingsOpen && <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setSettingsOpen(false)}>
      <section aria-labelledby="hos-settings-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="dialog">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold text-slate-800" id="hos-settings-title">설정</h2>
          <button aria-label="설정 닫기" className="min-h-11 min-w-11 rounded-lg text-xl text-slate-500" onClick={() => setSettingsOpen(false)} type="button">×</button>
        </div>
        <fieldset className="mt-3">
          <legend className="mb-3 text-sm font-semibold text-slate-600">알림 메시지 표시 시간</legend>
          <div className="grid grid-cols-5 gap-2">
            {HOS_TOAST_DURATIONS.map(seconds => <button aria-pressed={toastDuration === seconds} className={`min-h-10 rounded-lg px-1 text-sm font-bold ${toastDuration === seconds ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-700"}`} key={seconds} onClick={() => setToastDuration(seconds)} type="button">{seconds}초</button>)}
          </div>
        </fieldset>
      </section>
    </div>}
    {exitMessage && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4">
      <section aria-labelledby="hos-exit-message-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" role="alertdialog">
        <h2 className="text-lg font-extrabold" id="hos-exit-message-title">앱 종료</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{exitMessage}</p>
        <button autoFocus className="mt-5 min-h-12 w-full rounded-xl bg-blue-600 font-bold text-white" onClick={() => setExitMessage("")} type="button">확인</button>
      </section>
    </div>}
  </main>;
}
