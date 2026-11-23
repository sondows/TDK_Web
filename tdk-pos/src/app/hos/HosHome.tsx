"use client";
import { readJsonResponse } from "@/lib/api-response";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { getMenuChoice } from "@/lib/menu-choice-selection";
import { clampHosRemainingQuantity, getHosCancellationQuantity } from "@/lib/hos-order-quantity";
import { getHosMenuCategoryAtTop, getHosMenuTailSpacerHeight } from "@/lib/hos-menu-scroll";
import { initialAdultCountFromStewOrder } from "@/lib/initial-table-person-count";
import { resolveHosPeopleCount, type HosPeopleCount } from "@/lib/hos-people-count";
import { formatTradeBalance, tradeDescription, tradeTypeLabel, type CustomerTradeDetail, type CustomerTradeDetailResponse,
  type CustomerTradeResponse, type CustomerTradeRow } from "@/lib/customer-trade";
import HosTableCanvas from "./HosTableCanvas";
import QrMenuAddIcon from "@/components/QrMenuAddIcon";
import HosQrPendingOrders from "./HosQrPendingOrders";
import type { QrOrderTableListItem } from "@/lib/qr-orders-list-model";
import { shouldOpenQrOrdersForTable } from "@/lib/qr-order-notification-model";
import { POS_IDLE_RESET_ACTIVITY_EVENTS } from "@/lib/pos-idle-reset";
import { formatHosNavBadge } from "@/lib/hos-nav-counts";
import { shouldShowHosEmptyTableState } from "@/lib/hos-table-view-state";

type TableRow = {
  tableId: number; tableNo: string; tableName: string | null; positionX: number; positionY: number;
  layoutWidth: number; layoutHeight: number; isVisible: boolean; sessionId: number | null;
  amountDue: number; hasConfirmedOrder?: boolean; personCount?: number | null; babyCount?: number | null; openedAt?: string | null; customerName?: string | null; hasActiveQrToken?: boolean; hasPendingQrOrder?: boolean; hasQrOrderHistory?: boolean; hasTableToken?: boolean; mergedSourceTableNos: string[];
  isMergedSource: boolean; mergedIntoTableNo: string | null;
};
type OrderItem = {
  orderItemId: number; menuId: number | null; parentOrderItemId: number | null; itemType: string;
  itemName: string; qty: number; unitPrice: string; totalAmount: string; effectiveQty: number; cancelledQty: number; status: string;
  options: Array<{ optionName: string; qty: number; unitPrice: string }>;
};
type TableDetail = {
  table: { tableId: number; tableNo: string; tableName: string | null };
  session: { sessionId: number; relatedSessionIds: number[]; customerId: number | null; customerName: string | null; personCount: number; babyCount: number } | null;
  orders: Array<{ orderId: number; status: string; orderedAt: string; totalAmount: string; items: OrderItem[] }>;
};
type HosCustomer = { customerId: number; name: string; isPaymentManaged: boolean; createdAt: string; tradeBalance?: number };
type TradePeriod = "all" | "90" | "30" | "month";
type Menu = { menuId: number; categoryId: number | null; name: string; price: string; categoryName: string | null };
type Modifier = { menuId: number; modifierGroupId: number; groupName: string; choiceDefaultOptionId: number | null;
  modifierOptionId: number; optionName: string; priceDelta: string; optionSortOrder: number };
type Component = { menuComponentId: number; menuId: number; componentMenuId: number; itemName: string; quantity: number };
type Catalog = { menus: Menu[]; categories: Array<{ categoryId: number; name: string; tabColor: string | null }>; modifiers: Modifier[]; components: Component[] };
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
  const body = await readJsonResponse(response, response.url, "API request").catch(() => null) as T | null;
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

export default function HosHome({ staffLoginId, idleResetSeconds }: { staffLoginId: string | null; idleResetSeconds: number }) {
  const router = useRouter();
  const sessionRefreshRequestedRef = useRef(false);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [storeOrderTableCount, setStoreOrderTableCount] = useState<number | null>(null);
  const [qrPendingOrderCount, setQrPendingOrderCount] = useState<number | null>(null);
  const [qrOrderTables, setQrOrderTables] = useState<QrOrderTableListItem[]>([]);
  const currentQrOrderTables = qrOrderTables;
  const [qrOrdersBlockingUiOpen, setQrOrdersBlockingUiOpen] = useState(false);
  const [dividerPositions, setDividerPositions] = useState<number[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [screen, setScreen] = useState<"tables" | "qrOrders" | "detail" | "menu" | "customer" | "balance" | "tradeDetail">("tables");
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
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [detailSheet, setDetailSheet] = useState<"customer" | "people" | null>(null);
  const [detailSheetClosing, setDetailSheetClosing] = useState(false);
  const [detailSheetEntering, setDetailSheetEntering] = useState(false);
  const customerDataLoadedKeysRef = useRef(new Set<string>());
  const [peopleDraft, setPeopleDraft] = useState<HosPeopleCount>({ personCount: 0, babyCount: 0 });
  const [peopleSavedOverride, setPeopleSavedOverride] = useState<{ sessionId: number } & HosPeopleCount | null>(null);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [peopleError, setPeopleError] = useState("");
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
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toastDuration, setToastDuration] = useState<number>(2);
  const [toastDurationLoaded, setToastDurationLoaded] = useState(false);
  const [successToast, setSuccessToast] = useState<{ message: string; position: "top" | "center" } | null>(null);
  const [leaveCartConfirmTarget, setLeaveCartConfirmTarget] = useState<{ tableId: number; draftSignature: string } | null>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [exitMessage, setExitMessage] = useState("");
  const screenRef = useRef(screen);
  const busyRef = useRef(busy);
  const clearDraftLockRef = useRef(false);
  const leaveCartLockRef = useRef(false);
  const leaveCartConfirmRef = useRef<{ tableId: number; draftSignature: string } | null>(null);
  const draftRef = useRef<DraftItem[]>([]);
  const detailBackGuardRef = useRef(false);
  const ignoreDetailBackPopRef = useRef(false);
  const fullCancelLockRef = useRef(false);
  const successToastTimerRef = useRef<number | null>(null);
  const sendLock = useRef(false);
  const peopleSaveLockRef = useRef(false);
  const logoutInFlightRef = useRef(false);
  const detailSheetCloseTimerRef = useRef<number | null>(null);
  const detailSheetEnterFrameRef = useRef<number | null>(null);
  const detailSheetAfterCloseRef = useRef<"customer" | "people" | null>(null);
  const optionAddLockRef = useRef(false);
  const tableRequestRef = useRef<Promise<void> | null>(null);
  const detailRequestVersionRef = useRef(0);
  const detailRequestsInFlightRef = useRef(new Set<number>());
  const activeDetailTableIdRef = useRef<number | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const tableScreenRef = useRef<HTMLElement | null>(null);
  const menuTabsRef = useRef<HTMLDivElement | null>(null);
  const cartSummaryRef = useRef<HTMLSpanElement | null>(null);
  const cartPulseAnimationRef = useRef<Animation | null>(null);
  const cartFlightIdRef = useRef(0);
  const menuListRef = useRef<HTMLDivElement | null>(null);
  const menuTailSpacerRef = useRef<HTMLDivElement | null>(null);
  const menuSectionRefs = useRef(new Map<number, HTMLElement>());
  const menuTabRefs = useRef(new Map<number | null, HTMLButtonElement>());
  const menuScrollAnimationRef = useRef<number | null>(null);
  const menuScrollTargetRef = useRef<number | null>(null);
  const programmaticMenuScrollRef = useRef(false);
  const keepMenuOpenAfterOptionRef = useRef(false);
  const optionFlightOriginRef = useRef<CartPoint | null>(null);
  const closeLeaveCartConfirmation = useCallback(() => {
    leaveCartConfirmRef.current = null;
    setLeaveCartConfirmTarget(null);
  }, []);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

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
        const result = await readJson<{ tables: TableRow[]; qrOrderTables?: QrOrderTableListItem[]; dividerPositions?: number[]; storeOrderTableCount?: number; qrPendingOrderCount?: number }>(await fetchHos("/api/hos/tables", { cache: "no-store" }));
        setTables(result.tables);
        setQrOrderTables(result.qrOrderTables ?? []);
        if (Number.isSafeInteger(result.storeOrderTableCount) && Number(result.storeOrderTableCount) >= 0) setStoreOrderTableCount(Number(result.storeOrderTableCount));
        if (Number.isSafeInteger(result.qrPendingOrderCount) && Number(result.qrPendingOrderCount) >= 0) setQrPendingOrderCount(Number(result.qrPendingOrderCount));
        setDividerPositions(Array.isArray(result.dividerPositions) ? result.dividerPositions : []);
        setError("");
      } catch {
        setError("테이블 정보를 불러오지 못했습니다.");
      } finally {
        setRefreshing(false);
        setManualRefreshing(false);
        tableRequestRef.current = null;
      }
    })();
    tableRequestRef.current = request;
    return request;
  }, []);

  const returnToTables = useCallback(() => {
    detailRequestVersionRef.current += 1;
    activeDetailTableIdRef.current = null;
    setDetail(null); setScreen("tables"); setError("");
    void loadTables();
  }, [loadTables]);

  useEffect(() => {
    if (screen !== "tables" && screen !== "qrOrders") return;
    const firstLoad = window.setTimeout(() => void loadTables(), 0);
    const timer = window.setInterval(() => void loadTables(), 6000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(timer);
    };
  }, [loadTables, screen]);

  useEffect(() => {
    if (screen !== "qrOrders" || !Number.isInteger(idleResetSeconds) || idleResetSeconds <= 0 || busy || qrOrdersBlockingUiOpen || settingsOpen || exitConfirmOpen) return;
    let timer: number | undefined;
    const restartTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setDetail(null);
        setScreen("tables");
      }, idleResetSeconds * 1000);
    };
    POS_IDLE_RESET_ACTIVITY_EVENTS.forEach(eventName => window.addEventListener(eventName, restartTimer, { capture: true, passive: eventName !== "keydown" }));
    restartTimer();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      POS_IDLE_RESET_ACTIVITY_EVENTS.forEach(eventName => window.removeEventListener(eventName, restartTimer, { capture: true }));
    };
  }, [busy, exitConfirmOpen, idleResetSeconds, qrOrdersBlockingUiOpen, screen, settingsOpen]);

  useEffect(() => {
    if (screen !== "detail") return;
    if (!detailBackGuardRef.current) {
      window.history.pushState({ ...(window.history.state ?? {}), hosDetailBackGuard: true }, "", window.location.href);
      detailBackGuardRef.current = true;
    }
    const onPopState = () => {
      if (ignoreDetailBackPopRef.current) {
        ignoreDetailBackPopRef.current = false;
        detailBackGuardRef.current = false;
        return;
      }
      detailBackGuardRef.current = false;
      if (busyRef.current || sendLock.current) {
        setError("처리 중에는 주문 화면에서 나갈 수 없습니다.");
        window.history.pushState({ ...(window.history.state ?? {}), hosDetailBackGuard: true }, "", window.location.href);
        detailBackGuardRef.current = true;
        return;
      }
      const currentDraft = draftRef.current;
      if (leaveCartConfirmRef.current) {
        leaveCartConfirmRef.current = null;
        setLeaveCartConfirmTarget(null);
      } else if (currentDraft.length > 0 && activeDetailTableIdRef.current != null) {
        const target = { tableId: activeDetailTableIdRef.current, draftSignature: JSON.stringify(currentDraft) };
        leaveCartConfirmRef.current = target;
        setLeaveCartConfirmTarget(target);
      } else {
        returnToTables();
        return;
      }
      window.history.pushState({ ...(window.history.state ?? {}), hosDetailBackGuard: true }, "", window.location.href);
      detailBackGuardRef.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (detailBackGuardRef.current) {
        ignoreDetailBackPopRef.current = true;
        detailBackGuardRef.current = false;
        const clearIgnoredPop = () => {
          ignoreDetailBackPopRef.current = false;
          detailBackGuardRef.current = false;
          window.removeEventListener("popstate", clearIgnoredPop);
          if (screenRef.current === "detail") {
            window.history.pushState({ ...(window.history.state ?? {}), hosDetailBackGuard: true }, "", window.location.href);
            detailBackGuardRef.current = true;
          }
        };
        window.addEventListener("popstate", event => {
          clearIgnoredPop();
          event.stopImmediatePropagation();
        }, { once: true });
        window.history.back();
      }
    };
  }, [returnToTables, screen]);

  useEffect(() => {
    if (!leaveCartConfirmTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLeaveCartConfirmation();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeLeaveCartConfirmation, leaveCartConfirmTarget]);

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
      const atPageTop = container.scrollTop <= 0 && window.scrollY <= 0 && document.documentElement.scrollTop <= 0;
      if (!atPageTop || busy || event.touches.length !== 1) { startY = null; return; }
      startY = event.touches[0].clientY;
      distance = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startY === null || event.touches.length !== 1) return;
      if (container.scrollTop > 0 || window.scrollY > 0 || document.documentElement.scrollTop > 0) { startY = null; distance = 0; setPullDistance(0); return; }
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

  const catalogRefreshInFlightRef = useRef(false);
  useEffect(() => {
    if (screen !== "menu") return;
    const refresh = () => {
      if (catalogRefreshInFlightRef.current || document.visibilityState === "hidden") return;
      catalogRefreshInFlightRef.current = true;
      void loadCatalog().then(next => {
        setActiveCategoryId(current => current !== null && next.categories.some(category => category.categoryId === current)
          ? current : next.categories[0]?.categoryId ?? null);
      }).catch(() => undefined).finally(() => { catalogRefreshInFlightRef.current = false; });
    };
    const timer = window.setInterval(refresh, 45_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadCatalog, screen]);

  const refreshDetail = useCallback(async (tableId: number) => {
    if (activeDetailTableIdRef.current !== tableId) return;
    if (detailRequestsInFlightRef.current.has(tableId)) return;
    detailRequestsInFlightRef.current.add(tableId);
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
    } finally {
      detailRequestsInFlightRef.current.delete(tableId);
    }
  }, []);

  const activeTableId = detail?.table.tableId ?? null;
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
    const customerPickerOpen = screen === "detail" && detailSheet === "customer";
    if (screen !== "customer" && screen !== "balance" && !customerPickerOpen) return;
    const key = balanceView ? "balance" : "plain";
    if (customerPickerOpen && customerDataLoadedKeysRef.current.has(key)) {
      setCustomersLoadedKey(key);
      return;
    }
    const controller = new AbortController();
    void fetchHos(`/api/hos/customers${balanceView ? "?includeBalance=1" : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await readJsonResponse(response, response.url, "API request") as { success?: boolean; customers?: HosCustomer[]; message?: string };
        if (!response.ok || !result.success || !Array.isArray(result.customers)) throw new Error(result.message || "고객 목록을 불러오지 못했습니다.");
        if (!controller.signal.aborted) { customerDataLoadedKeysRef.current.add(key); setHosCustomers(result.customers); setCustomersLoadedKey(key); setCustomerError(""); }
      })
      .catch(cause => { if (!controller.signal.aborted) setCustomerError(cause instanceof Error ? cause.message : "고객 목록을 불러오지 못했습니다."); })
      .finally(() => undefined);
    return () => controller.abort();
  }, [balanceView, detailSheet, screen]);

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
        const result = await readJsonResponse(response, response.url, "API request") as CustomerTradeResponse;
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
        const result = await readJsonResponse(response, response.url, "API request") as CustomerTradeDetailResponse;
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
    setCartSheetOpen(false);
    if (cancelMode) {
      setCancelMode(false);
      setCancellations([]);
      if (!draft.length) setPendingTableId(null);
    }
    try {
      const currentCatalog = await loadCatalog();
      const defaultCategory = currentCatalog.categories[0];
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

  function removeDraftItem(index: number) {
    setDraft(rows => rows.filter((_, rowIndex) => rowIndex !== index));
    if (draft.length === 1 && !cancellations.length) setPendingTableId(null);
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
    currentSessionIdOverride?: number; keepDetailOpenAfterCancel?: boolean; returnToDetailAfterOrder?: boolean }) {
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
        const result = await readJsonResponse(response, response.url, "API request").catch(() => null) as { success?: boolean; message?: string } | null;
        if (!response.ok || !result?.success) throw new Error(result?.message || `취소 전송에 실패했습니다. (HTTP ${response.status})`);
      } else {
        let sessionId = detail.session?.sessionId;
        if (!sessionId) {
          const initialPersonCount = initialAdultCountFromStewOrder(
            draft,
            catalog?.menus ?? [],
            catalog?.categories ?? [],
          );
          const created = await readJson<{ sessionId: number }>(await fetchHos("/api/table-sessions", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tableId: detail.table.tableId, personCount: initialPersonCount, babyCount: 0 }),
          }));
          sessionId = created.sessionId;
          setDetail(current => current ? { ...current,
            session: { sessionId: created.sessionId, relatedSessionIds: [created.sessionId], customerId: null, customerName: null, personCount: initialPersonCount, babyCount: 0 } } : current);
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
      if (!submittingCancellations && options?.returnToDetailAfterOrder) {
        const tableId = detail.table.tableId;
        setDraft([]);
        setCancellations([]);
        setPendingTableId(null);
        setCancelMode(false);
        setCartSheetOpen(false);
        setScreen("detail");
        setError("");
        const requestVersion = ++detailRequestVersionRef.current;
        activeDetailTableIdRef.current = tableId;
        try {
          const latest = await readJson<TableDetail>(await fetchHos(`/api/hos/tables/${tableId}`, { cache: "no-store" }));
          if (requestVersion === detailRequestVersionRef.current && activeDetailTableIdRef.current === tableId && latest.table.tableId === tableId) {
            setDetail(latest);
          }
        } catch {
          if (requestVersion === detailRequestVersionRef.current && activeDetailTableIdRef.current === tableId) {
            setError("주문은 전송되었지만 최신 주문내역을 불러오지 못했습니다. 주문내역을 새로고침해 주세요.");
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

  function requestLeaveDetail() {
    if (busy || sendLock.current || leaveCartLockRef.current) return;
    const currentDraft = draftRef.current;
    if (!currentDraft.length) {
      returnToTables();
      return;
    }
    const tableId = detail?.table.tableId;
    if (tableId == null || leaveCartConfirmRef.current) return;
    const target = { tableId, draftSignature: JSON.stringify(currentDraft) };
    leaveCartConfirmRef.current = target;
    setLeaveCartConfirmTarget(target);
  }

  function discardDraftAndLeave() {
    const target = leaveCartConfirmRef.current;
    if (!target || leaveCartLockRef.current || busy || sendLock.current) return;
    leaveCartLockRef.current = true;
    try {
      const currentDraft = draftRef.current;
      if (detail?.table.tableId !== target.tableId || activeDetailTableIdRef.current !== target.tableId
        || !currentDraft.length || JSON.stringify(currentDraft) !== target.draftSignature) {
        closeLeaveCartConfirmation();
        setError("장바구니 내용이 변경되어 비우지 않았습니다. 다시 확인해 주세요.");
        return;
      }
      draftRef.current = [];
      setDraft([]);
      if (!cancellations.length) setPendingTableId(null);
      closeLeaveCartConfirmation();
      returnToTables();
    } finally {
      window.setTimeout(() => { leaveCartLockRef.current = false; }, 0);
    }
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
    if (logoutInFlightRef.current) return;
    logoutInFlightRef.current = true;
    setLogoutError("");
    setBusy(true);
    try {
      const response = await fetchHos("/api/hos/auth/logout", { method: "POST" });
      if (response.status === 401) {
        setLogoutConfirmOpen(false);
        router.replace("/tdkhos");
        return;
      }
      if (!response.ok) throw new Error("로그아웃하지 못했습니다. 다시 시도해 주세요.");
      setDetail(null);
      setDraft([]);
      setCancellations([]);
      setScreen("tables");
      setLogoutConfirmOpen(false);
      router.replace("/tdkhos");
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause.message : "로그아웃하지 못했습니다.");
    } finally {
      logoutInFlightRef.current = false;
      setBusy(false);
    }
  }

  const orderItems = (detail?.orders ?? []).flatMap(order => order.items
    .filter(item => item.itemType !== "COMPONENT" && item.effectiveQty > 0)
    .map(item => ({ ...item, orderStatus: order.status })));
  const stewOrderPeopleCount = initialAdultCountFromStewOrder(
    orderItems.flatMap(item => item.menuId === null ? [] : [{ menuId: item.menuId, qty: item.effectiveQty }]),
    catalog?.menus ?? [], catalog?.categories ?? [],
  );
  const storedPeopleOverride = detail?.session && peopleSavedOverride?.sessionId === detail.session.sessionId
    && peopleSavedOverride.personCount === detail.session.personCount && peopleSavedOverride.babyCount === detail.session.babyCount
    ? peopleSavedOverride : null;
  const currentPeopleCount = resolveHosPeopleCount({
    personCount: detail?.session?.personCount,
    babyCount: detail?.session?.babyCount,
    stewOrderCount: stewOrderPeopleCount,
    savedOverride: storedPeopleOverride,
  });
  const confirmedOrderAmount = detail?.orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0) ?? 0;
  const draftQuantityTotal = draft.reduce((sum, item) => sum + item.qty, 0);
  const draftOrderAmount = draft.reduce((sum, item) => {
    const menu = catalog?.menus.find(candidate => candidate.menuId === item.menuId);
    const optionAmount = item.options.reduce((optionSum, option) => optionSum +
      Number(catalog?.modifiers.find(candidate => candidate.modifierOptionId === option.modifierOptionId)?.priceDelta ?? 0) * option.qty, 0);
    return sum + (Number(menu?.price ?? 0) + optionAmount) * item.qty;
  }, 0);
  const cartHasItems = draftQuantityTotal > 0;
  const cartPeekHeight = cartHasItems ? 57.6 : 17.28;
  const orderAmount = confirmedOrderAmount;
  const cancellableItems = orderItems.filter(item => ["OPEN", "ACCEPTED"].includes(item.orderStatus) && item.status !== "CANCELLED");
  const cancellationRequests = cancellations.map(item => {
    const orderItem = orderItems.find(candidate => candidate.orderItemId === item.orderItemId);
    return orderItem ? { orderItemId: item.orderItemId,
      qty: getHosCancellationQuantity(orderItem.effectiveQty, item.keepQty) } : null;
  }).filter((item): item is { orderItemId: number; qty: number } => item !== null && item.qty > 0);
  const menuSections = (catalog?.categories ?? []).map(category => ({ ...category,
    displayName: category.name,
    menus: (catalog?.menus ?? []).filter(menu => menu.categoryId === category.categoryId),
  }));
  const defaultMenuCategoryId = menuSections[0]?.categoryId ?? null;
  const nonEmptyMenuSections = menuSections.filter(section => section.menus.length > 0);
  const categorizedMenuIds = new Set(nonEmptyMenuSections.flatMap(section => section.menus.map(menu => menu.menuId)));
  const uncategorizedMenus = (catalog?.menus ?? []).filter(menu => !categorizedMenuIds.has(menu.menuId));
  const menuSectionsForDisplay = [...nonEmptyMenuSections,
    ...(uncategorizedMenus.length ? [{ categoryId: -1, name: "", displayName: "", menus: uncategorizedMenus }] : [])];

  const updateMenuTailSpacer = useCallback(() => {
    const list = menuListRef.current;
    const spacer = menuTailSpacerRef.current;
    const lastTabSection = [...menuSectionRefs.current.entries()].filter(([categoryId]) => categoryId !== -1).at(-1)?.[1];
    if (!list || !spacer || !lastTabSection) return;

    const listTop = list.getBoundingClientRect().top;
    const sectionTop = list.scrollTop + lastTabSection.getBoundingClientRect().top - listTop;
    const currentSpacerHeight = spacer.getBoundingClientRect().height;
    const contentHeightWithoutSpacer = Math.max(0, list.scrollHeight - currentSpacerHeight);
    const requiredHeight = getHosMenuTailSpacerHeight(sectionTop, list.clientHeight, contentHeightWithoutSpacer);
    if (Math.abs(currentSpacerHeight - requiredHeight) > 1) spacer.style.height = `${requiredHeight}px`;
  }, []);

  useEffect(() => {
    if (screen !== "menu") return;
    const list = menuListRef.current;
    if (!list) return;
    const observer = new ResizeObserver(updateMenuTailSpacer);
    observer.observe(list);
    for (const section of menuSectionRefs.current.values()) observer.observe(section);
    const frame = window.requestAnimationFrame(updateMenuTailSpacer);
    window.addEventListener("resize", updateMenuTailSpacer);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateMenuTailSpacer);
    };
  }, [cartPeekHeight, catalog, screen, updateMenuTailSpacer]);

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
    updateMenuTailSpacer();
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
    const positions = menuSectionsForDisplay.filter(section => section.categoryId !== -1).map(section => ({
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
      const result = await readJsonResponse(response, response.url, "API request") as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message || "고객 연결을 저장하지 못했습니다.");
      if (screen === "detail" && detailSheet === "customer") closeDetailSheet();
      else setScreen("detail");
      await refreshDetail(detail.table.tableId);
      void loadTables();
    } catch (cause) {
      setCustomerError(cause instanceof Error ? cause.message : "고객 연결을 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function savePeopleCount() {
    const sessionId = detail?.session?.sessionId;
    const tableId = detail?.table.tableId;
    if (!sessionId || !tableId || peopleBusy || peopleSaveLockRef.current) return;
    peopleSaveLockRef.current = true;
    setPeopleBusy(true);
    setPeopleError("");
    try {
      const response = await fetchHos(`/api/table-sessions/${sessionId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(peopleDraft),
      });
      const result = await readJsonResponse(response, response.url, "API request") as { success?: boolean; personCount?: number; babyCount?: number; message?: string };
      if (!response.ok || !result.success || result.personCount === undefined || result.babyCount === undefined) {
        throw new Error(result.message || "인원 정보를 저장하지 못했습니다.");
      }
      const saved = { sessionId, personCount: result.personCount, babyCount: result.babyCount };
      setPeopleSavedOverride(saved);
      setDetail(current => current?.session?.sessionId === sessionId
        ? { ...current, session: { ...current.session, personCount: result.personCount!, babyCount: result.babyCount! } }
        : current);
      closeDetailSheet();
      void refreshDetail(tableId);
      void loadTables();
    } catch (cause) {
      setPeopleError(cause instanceof Error ? cause.message : "인원 정보를 저장하지 못했습니다.");
    } finally {
      peopleSaveLockRef.current = false;
      setPeopleBusy(false);
    }
  }

  function openDetailSheet(target: "customer" | "people") {
    if (target === "customer") {
      setBalanceView(false);
      setManagedCustomersOnly(true);
      customerDataLoadedKeysRef.current.delete("balance");
    } else {
      setPeopleDraft(currentPeopleCount);
    }
    setDetailSheet(target);
    setDetailSheetClosing(false);
    setDetailSheetEntering(true);
    if (detailSheetEnterFrameRef.current !== null) window.cancelAnimationFrame(detailSheetEnterFrameRef.current);
    detailSheetEnterFrameRef.current = window.requestAnimationFrame(() => {
      setDetailSheetEntering(false);
      detailSheetEnterFrameRef.current = null;
    });
  }

  function closeDetailSheet(nextSheet: "customer" | "people" | null = null) {
    if (!detailSheet) return;
    if (detailSheetEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(detailSheetEnterFrameRef.current);
      detailSheetEnterFrameRef.current = null;
    }
    setDetailSheetEntering(false);
    if (detailSheetCloseTimerRef.current !== null) window.clearTimeout(detailSheetCloseTimerRef.current);
    detailSheetAfterCloseRef.current = nextSheet;
    setDetailSheetClosing(true);
    detailSheetCloseTimerRef.current = window.setTimeout(() => {
      const next = detailSheetAfterCloseRef.current;
      detailSheetAfterCloseRef.current = null;
      detailSheetCloseTimerRef.current = null;
      if (next) openDetailSheet(next);
      else {
        setDetailSheet(null);
        setDetailSheetClosing(false);
      }
    }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250);
  }

  function toggleDetailSheet(target: "customer" | "people") {
    if (!detail?.session?.sessionId || busy || peopleBusy) return;
    setCustomerError("");
    setPeopleError("");
    if (detailSheetClosing) {
      detailSheetAfterCloseRef.current = target === detailSheet ? null : target;
      return;
    }
    if (detailSheet === target) {
      closeDetailSheet();
      return;
    }
    if (detailSheet) {
      closeDetailSheet(target);
      return;
    }
    openDetailSheet(target);
  }

  function openTradeEntry(entry: CustomerTradeRow) {
    setSelectedTrade(entry);
    setCustomerError("");
    setScreen("tradeDetail");
  }

  useEffect(() => () => {
    if (menuScrollAnimationRef.current !== null) window.cancelAnimationFrame(menuScrollAnimationRef.current);
  }, []);

  useEffect(() => () => {
    if (detailSheetCloseTimerRef.current !== null) window.clearTimeout(detailSheetCloseTimerRef.current);
    if (detailSheetEnterFrameRef.current !== null) window.cancelAnimationFrame(detailSheetEnterFrameRef.current);
  }, []);

  useEffect(() => () => cartPulseAnimationRef.current?.cancel(), []);

  function openQrOrders() {
    setScreen("qrOrders");
  }

  const storeOrderBadge = formatHosNavBadge(storeOrderTableCount);
  const qrPendingOrderBadge = formatHosNavBadge(qrPendingOrderCount);

  return <main className={screen === "menu" || screen === "tables" || screen === "qrOrders" ? "flex h-dvh flex-col overflow-hidden bg-white text-slate-900" : "flex min-h-dvh flex-col bg-white pb-[env(safe-area-inset-bottom)] text-slate-900"} ref={mainRef}>
    {(screen === "tables" || screen === "qrOrders") ? <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 bg-[#F3F5F8] px-4 text-slate-900">
      <button aria-label="TDKON HOS" className="min-w-0 truncate bg-transparent p-0 text-left" onClick={() => { setExitMessage(""); setExitConfirmOpen(true); }} type="button"><strong className="text-lg font-extrabold text-[#2563EB]">TDKON HOS</strong></button>
      <button aria-label={"\uB85C\uADF8\uC544\uC6C3 \uD655\uC778"} className="min-h-11 max-w-[45%] shrink truncate bg-transparent px-1 text-right text-xs font-medium text-slate-500 disabled:opacity-60" disabled={busy} onClick={() => { setLogoutError(""); setLogoutConfirmOpen(true); }} title={staffLoginId ?? ""} type="button">{staffLoginId ?? ""}</button>
    </header> : screen === "detail" ? <header className="sticky top-0 z-20 bg-[#F3F5F8] px-3 pt-[15px] text-slate-900">
      <div className="flex min-h-12 items-center justify-between gap-2">
        <div className="flex min-w-0 shrink items-center gap-2">
          <button aria-label="테이블 배치로 돌아가기" className="flex min-h-11 min-w-0 shrink items-center gap-1.5 whitespace-nowrap bg-transparent pr-1 text-2xl font-bold text-slate-700 disabled:opacity-50" disabled={busy} onClick={requestLeaveDetail} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>{"\uC8FC\uBB38\uB0B4\uC5ED"}</span></button>
          <span className="shrink-0 text-xs font-medium text-slate-400">No.{detail?.table.tableNo}</span>
        </div>
        <div className="flex min-w-0 shrink items-center justify-end gap-2">
          {activeCustomerName && <span className="max-w-[25vw] truncate text-right text-sm font-semibold text-slate-700" title={activeCustomerName}>{activeCustomerName}</span>}
          <strong className="shrink-0 text-sm font-bold text-blue-700">{currentPeopleCount.personCount}/{currentPeopleCount.babyCount}</strong>
        </div>
      </div>

    </header> : screen === "customer" ? <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 pt-[15px]">
      <button aria-label="주문 화면으로 돌아가기" className="flex min-h-11 min-w-11 items-center gap-1.5 bg-transparent pr-2 text-2xl font-bold text-slate-700" onClick={() => setScreen("detail")} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>고객</span></button>
    </header> : screen === "balance" ? <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-1 border-b border-slate-200 bg-white px-2 pt-[15px]">
      <button aria-label="고객 목록으로 돌아가기" className="flex min-h-11 min-w-11 shrink-0 items-center gap-1 bg-transparent pr-1 text-xl font-bold text-slate-700" onClick={() => { setCustomerError(""); setScreen("customer"); }} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>잔액관리</span></button>
      <div aria-label="거래 조회기간" className="flex min-w-0 gap-1" role="group">{([ ["all", "전부"], ["90", "90"], ["30", "30"], ["month", "당월"] ] as const).map(([period, label]) => <button aria-pressed={tradePeriod === period} className={`min-h-9 min-w-9 rounded-lg px-2 text-xs font-bold ${tradePeriod === period ? "bg-blue-700 text-white" : "bg-blue-50 text-blue-700"}`} key={period} onClick={() => { setTradePeriod(period); setCustomerError(""); }} type="button">{label}</button>)}</div>
    </header> : screen === "tradeDetail" ? <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 pt-[15px]">
      <button aria-label="잔액관리로 돌아가기" className="flex min-h-11 items-center gap-1.5 bg-transparent pr-2 text-xl font-bold text-slate-700" onClick={() => { setCustomerError(""); setScreen("balance"); }} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>거래 상세</span></button>
    </header> : <header className={`sticky top-0 z-20 shrink-0 bg-[#F3F5F8] px-3 pt-[15px] text-slate-900 ${screen === "menu" ? "border-b border-[#DCE2EA]" : ""}`}>
        <div className="flex min-h-12 items-center justify-start gap-2">
        <button aria-label={"\uC8FC\uBB38\uD558\uAE30 \uD654\uBA74\uC73C\uB85C \uB3CC\uC544\uAC00\uAE30"} className="flex min-h-11 min-w-0 items-center gap-1.5 bg-transparent pr-2 text-2xl font-bold text-slate-700" onClick={() => setScreen("detail")} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>{"\uC8FC\uBB38\uD558\uAE30"}</span></button>
      </div>
    </header>}
    {error && <div className={`mx-3 mt-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 ${screen === "detail" ? "text-[17px]" : "text-sm"} font-semibold text-red-700`} role="alert">
      <span>{error}</span>
      {screen === "tables" && <button className="shrink-0 rounded-md border border-red-300 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={refreshing} onClick={() => void loadTables(true)} type="button">{refreshing ? "조회 중" : "다시 시도"}</button>}
    </div>}

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

    {screen === "tables" && <section className="relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3 pb-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)]" ref={tableScreenRef}>
      <div aria-live="polite" className={`flex items-center justify-center gap-2 overflow-hidden text-xs text-slate-500 transition-[height] ${manualRefreshing || pullDistance > 0 ? "h-8" : "h-0"}`}>
        {manualRefreshing ? <><span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />테이블 정보 갱신 중</>
          : pullDistance > 0 && <span>{pullDistance >= 64 ? "놓으면 갱신" : "아래로 당겨 갱신"}</span>}
      </div>
      {tables.length > 0
        ? <HosTableCanvas tables={tables.map(table => { const indicator = currentQrOrderTables.find(candidate => candidate.tableId === table.tableId); return { ...table,
          hasActiveQrToken: indicator?.hasActiveQrToken ?? table.hasActiveQrToken,
          hasPendingQrOrder: indicator?.hasPendingQrOrder ?? table.hasPendingQrOrder,
          hasQrOrderHistory: indicator?.hasQrOrderHistory ?? table.hasQrOrderHistory }; })} dividerPositions={dividerPositions} disabled={busy} onSelect={table => {
          if (shouldOpenQrOrdersForTable(table)) { openQrOrders(); return; }
          const destination = table.isMergedSource
            ? tables.find(candidate => candidate.tableNo === table.mergedIntoTableNo) : null;
          void openTable(destination ?? table);
        }} />
        : shouldShowHosEmptyTableState(tables.length, refreshing, error) && <p className="mx-auto grid min-h-40 max-w-[900px] place-items-center rounded-xl border border-slate-300 bg-white text-sm text-slate-500">사용 가능한 테이블이 없습니다.</p>}
    </section>}
    {screen === "qrOrders" && <section className="flex min-h-0 flex-1 overflow-hidden px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))]"><HosQrPendingOrders onBlockingUiChange={setQrOrdersBlockingUiOpen} onChanged={() => void loadTables(true)} onPendingCountChange={setQrPendingOrderCount} /></section>}

    {(screen === "tables" || screen === "qrOrders") && <nav aria-label={"\uC8FC\uC694 \uD654\uBA74"} className="fixed inset-x-0 bottom-0 z-30 bg-[#F3F5F8] pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex min-h-[4.5rem] w-full max-w-3xl">
        <button aria-current={screen === "tables" ? "page" : undefined} aria-label={"\uB9E4\uC7A5"} className={"flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 bg-transparent text-sm " + (screen === "tables" ? "text-blue-700" : "text-slate-500")} onClick={() => setScreen("tables")} type="button">
          <span className="relative inline-flex size-6 items-center justify-center"><svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5M5.5 9v11h13V9M9 20v-6h6v6" /></svg>{storeOrderBadge && <span aria-hidden="true" className="absolute -right-2 -top-1 z-10 grid min-h-[17px] min-w-[17px] place-items-center rounded-full bg-blue-600 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[#F3F5F8]">{storeOrderBadge}</span>}</span>
          <span className="text-[11px] leading-tight">{"\uB9E4\uC7A5"}</span>
        </button>
        <button aria-current={screen === "qrOrders" ? "page" : undefined} aria-label={"QR\uC8FC\uBB38"} className={"flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 bg-transparent text-sm " + (screen === "qrOrders" ? "text-blue-700" : "text-slate-500")} onClick={() => setScreen("qrOrders")} type="button">
          <span className="relative inline-flex size-6 items-center justify-center"><svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect height="7" rx="1" width="7" x="3" y="3"/><rect height="7" rx="1" width="7" x="14" y="3"/><rect height="7" rx="1" width="7" x="3" y="14"/><path d="M14 14h3v3h-3zM20 14v2m-3 4h3v-3"/></svg>{qrPendingOrderBadge && <span aria-hidden="true" className="absolute -right-2 -top-1 z-10 grid min-h-[17px] min-w-[17px] place-items-center rounded-full bg-blue-600 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[#F3F5F8]">{qrPendingOrderBadge}</span>}</span>
          <span className="text-[11px] leading-tight">QR{"\uC8FC\uBB38"}</span>
        </button>
        <div className="flex flex-1">
          <button aria-expanded={settingsOpen} aria-haspopup="dialog" aria-pressed={settingsOpen} aria-label={"\uC124\uC815"} className={"flex min-h-[4.5rem] w-full flex-col items-center justify-center gap-0.5 bg-transparent text-sm " + (settingsOpen ? "text-blue-700" : "text-slate-500")} disabled={busy} onClick={() => setSettingsOpen(true)} type="button">
            <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z"/></svg>
            <span className="text-[11px] leading-tight">{"\uC124\uC815"}</span>
          </button>
        </div>
      </div>
    </nav>}

    {screen === "detail" && detail && <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col p-3">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(4.5rem+env(safe-area-inset-bottom)+0.75rem)]">
        <section aria-label="주문내역">
          {orderItems.length ? <div className="divide-y divide-slate-100">
            {orderItems.map(item => {
              const pending = cancellations.find(row => row.orderItemId === item.orderItemId);
              const keepQty = pending?.keepQty ?? item.effectiveQty;
              const canCancel = cancelMode && ["OPEN", "ACCEPTED"].includes(item.orderStatus) && item.status !== "CANCELLED";
              const displayQty = cancelMode && canCancel ? keepQty : item.effectiveQty;
              const itemAmount = Number(item.unitPrice || 0) * displayQty;
              const optionNames = item.options.map(option => option.optionName);
              return <article className={`py-3 ${pending && keepQty < item.effectiveQty ? "bg-red-50" : ""}`} key={item.orderItemId}>
                <div className={`grid items-center gap-x-2 ${canCancel ? "grid-cols-[minmax(0,1fr)_7rem_4.5rem]" : "grid-cols-[minmax(0,1fr)_auto_4.5rem]"}`}>
                  <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
                    <strong className={`${optionNames.length > 0 ? "max-w-[55%]" : "max-w-full"} min-w-0 shrink-0 truncate text-lg font-bold text-slate-900`} title={item.itemName}>{item.itemName}</strong>
                    {optionNames.length > 0 && <span className="min-w-0 flex-1 truncate text-[13px] leading-tight text-slate-400" title={optionNames.join(" · ")}>{optionNames.join(" · ")}</span>}
                  </div>
                  {canCancel ? <div aria-label={`${item.itemName} 남길 수량`} className="flex w-28 items-center justify-center gap-1.5">
                    <button aria-label={`${item.itemName} 남길 수량 감소`} aria-hidden={!canCancel} className={`size-9 shrink-0 rounded-lg bg-slate-100 text-[21px] font-bold disabled:opacity-40 ${canCancel ? "" : "invisible"}`} disabled={!canCancel || keepQty <= 0} onClick={() => changeKeepQuantity(item, -1)} tabIndex={canCancel ? 0 : -1} type="button">−</button>
                    <strong className="min-w-5 text-center text-[17px]">{money(displayQty)}</strong>
                    <button aria-label={`${item.itemName} 남길 수량 증가`} aria-hidden={!canCancel} className={`size-9 shrink-0 rounded-lg bg-slate-100 text-[21px] font-bold disabled:opacity-40 ${canCancel ? "" : "invisible"}`} disabled={!canCancel || keepQty >= item.effectiveQty} onClick={() => changeKeepQuantity(item, 1)} tabIndex={canCancel ? 0 : -1} type="button">+</button>
                  </div> : <strong className="shrink-0 whitespace-nowrap text-[15px] font-semibold text-slate-700">× {money(displayQty)}</strong>}
                  <strong className="min-w-[4.5rem] text-right text-[17px] font-semibold text-slate-800">{money(itemAmount)}</strong>
                </div>
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
          {cancelMode && cancellableItems.length > 0 && <button className="mt-3 min-h-11 w-full rounded-xl border border-red-200 bg-[#FFF0F0] text-sm font-extrabold text-[#DC2626] disabled:opacity-50" disabled={busy || !cancellableItems.length} onClick={() => void cancelAllExistingOrders()} type="button">전체취소</button>}
        </section>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-[17px] text-blue-700">
          <span className="font-bold">{"\uC8FC\uBB38\uAE08\uC561"}</span>
          <strong className="shrink-0 text-right font-extrabold">{money(orderAmount)}{"\uC6D0"}</strong>
        </div>


      </div>
      <nav aria-label="주문 작업" className={`fixed inset-x-0 bottom-0 ${detailSheet ? "z-50" : "z-30"} mx-auto w-full max-w-3xl border-t border-[#D1D5DB] bg-[#F3F5F8] pb-[env(safe-area-inset-bottom)]`}>
        <div className="flex min-h-[4.5rem] w-full">
        <button aria-label="주문추가" className={`flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 bg-transparent transition-colors active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gray-500 ${busy ? "text-slate-400" : "text-slate-500"}`} disabled={busy} onClick={() => void openMenuPicker()} type="button">
          <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>
          <span className="text-[11px] font-normal leading-tight">주문추가</span>
        </button>
        <button aria-label={cancelMode ? cancellationRequests.some(request => request.qty > 0) ? "취소 적용" : "주문취소 모드 닫기" : "주문취소"} className={`flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 bg-transparent transition-colors active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gray-500 ${busy || (!cancelMode && !cancellableItems.length) ? "text-slate-400" : "text-slate-500"}`} disabled={busy || (!cancelMode && !cancellableItems.length)} onClick={() => {
          if (cancelMode && cancellationRequests.some(request => request.qty > 0)) {
            void completeOrder();
          } else if (cancelMode) {
            setCancelMode(false); setCancellations([]);
            if (!draft.length) setPendingTableId(null);
          } else {
            setCancellations([]); setCancelMode(true);
            if (detail) setPendingTableId(detail.table.tableId);
          }
          setError("");
        }} type="button">
          <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></svg>
          <span className="text-[11px] font-normal leading-tight">{cancelMode && cancellationRequests.some(request => request.qty > 0) ? "취소 적용" : cancelMode ? "취소모드 닫기" : "주문취소"}</span>
        </button>
        <button aria-pressed={detailSheet === "customer" && !detailSheetClosing} aria-label={"\uACE0\uAC1D \uC120\uD0DD"} className={`flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 bg-transparent transition-colors active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gray-500 ${busy || !detail?.session?.sessionId ? "text-slate-400" : detailSheet === "customer" && !detailSheetClosing ? "text-blue-700" : "text-slate-500"}`} disabled={busy || !detail?.session?.sessionId} onClick={() => toggleDetailSheet("customer")} type="button">
          <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.25" /><path d="M5.5 20v-1.2A5.3 5.3 0 0 1 10.8 13.5h2.4a5.3 5.3 0 0 1 5.3 5.3V20z" /></svg>
          <span className="text-[11px] font-normal leading-tight">{"\uACE0\uAC1D"}</span>
        </button>
        <button aria-pressed={detailSheet === "people" && !detailSheetClosing} aria-label={"\uC778\uC6D0 \uAD00\uB9AC"} className={`flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 bg-transparent transition-colors active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gray-500 ${peopleBusy || !detail?.session?.sessionId ? "text-slate-400" : detailSheet === "people" && !detailSheetClosing ? "text-blue-700" : "text-slate-500"}`} disabled={peopleBusy || !detail?.session?.sessionId} onClick={() => toggleDetailSheet("people")} type="button">
          <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="9" cy="8" r="2.75" /><path d="M3.8 19v-1a4.2 4.2 0 0 1 4.2-4.2h2a4.2 4.2 0 0 1 4.2 4.2v1z" /><path d="M16 5.5a2.7 2.7 0 0 1 0 5.1m1.1 3.2a4 4 0 0 1 3.1 3.9V19h-2.3" /></svg>
          <span className="text-[11px] font-normal leading-tight">{"\uC778\uC6D0"}</span>
        </button>
        </div>
      </nav>
    </section>}

    {screen === "detail" && detail && detailSheet && <>
      <button aria-label={"\uD328\uB110 \uB2EB\uAE30"} className={`fixed inset-0 z-40 bg-slate-950/35 transition-opacity duration-250 ease-out motion-reduce:duration-0 ${(detailSheetClosing || detailSheetEntering) ? "pointer-events-none opacity-0" : "opacity-100"}`} onClick={() => closeDetailSheet()} type="button" />
      <section aria-label={detailSheet === "customer" ? "\uACE0\uAC1D \uC120\uD0DD" : "\uC778\uC6D0 \uAD00\uB9AC"} aria-modal="true" className={`fixed inset-x-0 z-[45] mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-8px_28px_rgba(15,23,42,0.2)] transition-transform duration-250 ease-out motion-reduce:duration-0 ${detailSheetClosing || detailSheetEntering ? "pointer-events-none" : ""}`} role="dialog" style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))", height: "67dvh", maxHeight: "calc(100dvh - 4.5rem - env(safe-area-inset-bottom))", transform: detailSheetClosing || detailSheetEntering ? "translateY(100%)" : "translateY(0)" }}>
        <header className="flex min-h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
          <h2 className="text-base font-bold text-slate-900">{detailSheet === "customer" ? "\uACE0\uAC1D \uC120\uD0DD" : "\uC778\uC6D0"}</h2>
          <div className="flex items-center gap-2">
            {detailSheet === "people" && <button className="min-h-10 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={peopleBusy} onClick={() => void savePeopleCount()} type="button">{peopleBusy ? "\uC800\uC7A5 \uC911" : "\uD655\uC778"}</button>}
            <button aria-label={"\uB2EB\uAE30"} className="flex size-10 items-center justify-center rounded-full text-2xl text-slate-500 active:bg-slate-100" onClick={() => closeDetailSheet()} type="button">{"\u00D7"}</button>
          </div>
        </header>
        {detailSheet === "customer" ? <>
          <div aria-label={"\uACE0\uAC1D \uBAA9\uB85D"} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4" role="listbox" style={{ WebkitOverflowScrolling: "touch" }}>
            {customerError && <p className="py-2 text-sm font-semibold text-red-700" role="alert">{customerError}</p>}
            {customerLoading && !hosCustomers.length ? <p className="py-8 text-center text-sm text-slate-500">{"\uACE0\uAC1D \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911\uC785\uB2C8\uB2E4."}</p>
              : !customerLoading && !customerError && hosCustomers.filter(customer => !managedCustomersOnly || customer.isPaymentManaged).length === 0
                ? <p className="py-8 text-center text-sm text-slate-500">{"\uD45C\uC2DC\uD560 \uACE0\uAC1D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>
                : hosCustomers.filter(customer => !managedCustomersOnly || customer.isPaymentManaged).map(customer => <button aria-selected={activeCustomerId === customer.customerId} className={"mb-2 flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left text-sm font-semibold " + (activeCustomerId === customer.customerId ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-800")} disabled={busy} key={customer.customerId} onClick={() => void chooseHosCustomer(activeCustomerId === customer.customerId ? null : customer)} role="option" type="button"><span className="min-w-0 flex-1 truncate">{customer.name}</span>{balanceView && customersLoadedKey === "balance" && !customerError && <span className="shrink-0 text-right text-sm font-semibold tabular-nums text-slate-600">{formatTradeBalance(customer.tradeBalance ?? 0)}</span>}{activeCustomerId === customer.customerId && <span className="shrink-0 text-xs">{"\uC120\uD0DD\uB428"}</span>}</button>)}
            {customerLoading && hosCustomers.length > 0 && <p className="py-2 text-center text-xs text-slate-400">{"\uACE0\uAC1D \uC815\uBCF4\uB97C \uAC31\uC2E0\uD558\uACE0 \uC788\uC2B5\uB2C8\uB2E4."}</p>}
          </div>
          <footer className="shrink-0 border-t border-slate-200 bg-[#F3F5F8] px-3 py-2">
            <div className="flex min-h-12 items-center gap-2">
              <button aria-checked={balanceView} aria-busy={balanceView && customerLoading} className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-slate-700" onClick={() => {
                if (!balanceView) {
                  customerDataLoadedKeysRef.current.delete("balance");
                  setCustomersLoadedKey("plain");
                }
                setBalanceView(value => !value);
              }} role="switch" type="button">
                <span className="whitespace-nowrap">{"\uC794\uC561\uBCF4\uAE30"}</span>
                <span aria-hidden="true" className={"relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 " + (balanceView ? "bg-blue-700" : "bg-slate-300")}><span className={"absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform duration-200 " + (balanceView ? "translate-x-5" : "translate-x-0")} /></span>
              </button>
              <button aria-checked={managedCustomersOnly} className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-slate-700" onClick={() => setManagedCustomersOnly(value => !value)} role="switch" type="button">
                <span className="whitespace-nowrap">{"\uC120\uBD88\uAD00\uB9AC"}</span>
                <span aria-hidden="true" className={"relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 " + (managedCustomersOnly ? "bg-blue-700" : "bg-slate-300")}><span className={"absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform duration-200 " + (managedCustomersOnly ? "translate-x-5" : "translate-x-0")} /></span>
              </button>
            </div>
            {balanceView && customerLoading && <p aria-live="polite" className="text-center text-[11px] text-slate-500">{"\uC794\uC561 \uC870\uD68C \uC911..."}</p>}
          </footer>
        </> : <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-5">
          {peopleError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">{peopleError}</p>}
          {([["personCount", "\uC131\uC778"], ["babyCount", "\uC544\uB3D9"]] as const).map(([key, label]) => <div className="flex min-h-16 items-center justify-between rounded-xl border border-slate-200 px-4" key={key}>
            <span className="text-base font-semibold text-slate-700">{label}</span>
            <div className="flex items-center gap-4">
              <button aria-label={label + " \uC778\uC6D0 \uAC10\uC18C"} className="size-10 rounded-full bg-slate-100 text-2xl font-semibold text-slate-700 disabled:opacity-40" disabled={peopleBusy || peopleDraft[key] <= 0} onClick={() => setPeopleDraft(current => ({ ...current, [key]: Math.max(0, current[key] - 1) }))} type="button">{"\u2212"}</button>
              <strong aria-live="polite" className="min-w-6 text-center text-lg tabular-nums">{peopleDraft[key]}</strong>
              <button aria-label={label + " \uC778\uC6D0 \uC99D\uAC00"} className="size-10 rounded-full bg-slate-100 text-2xl font-semibold text-slate-700 disabled:opacity-40" disabled={peopleBusy || peopleDraft[key] >= 99} onClick={() => setPeopleDraft(current => ({ ...current, [key]: Math.min(99, current[key] + 1) }))} type="button">+</button>
            </div>
          </div>)}
        </div>}
      </section>
    </>}

    {screen === "menu" && catalog && <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden px-3 pb-3">
      <div aria-label="메뉴 분류" className="-mx-3 grid shrink-0 grid-cols-6 gap-0 bg-[#F3F5F8] px-2 py-2" ref={menuTabsRef}>
        {menuSections.map(item => { const active = activeCategoryId === item.categoryId; return <button aria-pressed={active} className={`min-h-10 min-w-0 whitespace-nowrap rounded-lg px-0 text-center text-[clamp(0.625rem,3vw,0.875rem)] font-semibold leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800 ${active ? "bg-[#777777] text-white" : "bg-transparent text-[#777777]"}`} key={item.categoryId} onClick={() => scrollToMenuCategory(item.categoryId)} ref={element => {
          if (element) menuTabRefs.current.set(item.categoryId, element); else menuTabRefs.current.delete(item.categoryId);
        }} type="button">{item.displayName}</button>; })}
      </div>
      <div className="-mx-3 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden" onPointerDown={cancelProgrammaticMenuScroll} onScroll={syncMenuCategoryFromScroll} onTouchStart={cancelProgrammaticMenuScroll} onWheel={cancelProgrammaticMenuScroll} ref={menuListRef} style={{ WebkitOverflowScrolling: "touch", paddingBottom: `${cartPeekHeight + 40}px` }}>
        {menuSectionsForDisplay.map((section, index) => <div className={`-mx-3 mb-[11.2px] border-t border-[#e5ebf0] bg-[#fbfcfe] px-3 shadow-[0_1px_3px_rgba(71,85,105,0.08)] ${index === menuSectionsForDisplay.length - 1 ? "mb-0" : ""}`} data-menu-category-section={section.categoryId} key={section.categoryId} ref={element => {
          if (element) menuSectionRefs.current.set(section.categoryId, element); else menuSectionRefs.current.delete(section.categoryId);
        }}>
          {section.menus.map(menu => <div className="flex min-h-14 w-full items-center border-b border-slate-100 last:border-b-0" key={menu.menuId}>
            <button className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 bg-transparent px-1 py-3 text-left active:bg-blue-50" onClick={event => chooseMenu(menu, true, event.currentTarget)} type="button"><span className="flex min-w-0 flex-1 items-baseline gap-1 whitespace-nowrap"><span className="max-w-full shrink-0 truncate text-[19px] font-bold">{menu.name}</span>{catalog?.modifiers.some(modifier => modifier.menuId === menu.menuId && modifier.groupName === "매운맛") && <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-400" title="2.약간매운맛">2.약간매운맛</span>}</span><span className="shrink-0 whitespace-nowrap text-[17px] font-semibold text-slate-600">{money(Number(menu.price))}</span></button>
            <button aria-label={`${menu.name} 장바구니에 1개 추가`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 shadow-none transition active:scale-95" onClick={event => quickAddMenu(menu, event.currentTarget)} type="button"><QrMenuAddIcon className="pointer-events-none h-[25px] w-[25px] overflow-visible" color="#A0A8B5" /></button>
          </div>)}
        </div>)}
        <div aria-hidden="true" className="pointer-events-none w-full" ref={menuTailSpacerRef} style={{ height: 0 }} />
      </div>
    </section>}

    {screen === "menu" && <>
      {cartSheetOpen && <button aria-label="장바구니 닫기" className="fixed inset-0 z-30 bg-slate-950/45" onClick={() => setCartSheetOpen(false)} type="button" />}
      <section aria-label="장바구니 상세" aria-modal={cartSheetOpen || undefined} className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-8px_28px_rgba(15,23,42,0.2)] transition-transform duration-300 ease-out motion-reduce:transition-none" role={cartSheetOpen ? "dialog" : undefined} style={{ height: "82dvh", transform: cartSheetOpen ? "translateY(0)" : `translateY(calc(100% - ${cartPeekHeight}px))`, paddingBottom: "env(safe-area-inset-bottom)" }}>
        <button aria-controls="hos-cart-panel-content" aria-expanded={cartSheetOpen} aria-label={cartHasItems ? `장바구니 ${draftQuantityTotal}개, ${money(draftOrderAmount)}원, ${cartSheetOpen ? "닫기" : "열기"}` : `빈 장바구니 ${cartSheetOpen ? "닫기" : "열기"}`} className="flex shrink-0 items-center justify-center bg-[#1D5EFF] px-4 text-white transition-[height] duration-300 ease-out motion-reduce:transition-none" onClick={() => setCartSheetOpen(open => !open)} style={{ height: cartSheetOpen ? 57.6 : cartPeekHeight }} type="button">
          {cartSheetOpen ? <span className="flex w-full max-w-2xl items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2"><strong className="truncate text-left text-[17px] font-extrabold" ref={cartSummaryRef}>장바구니</strong>{cartHasItems && <span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold tabular-nums">{draftQuantityTotal}개</span>}</span><span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[17px] font-extrabold tabular-nums">{cartHasItems ? `${money(draftOrderAmount)}원` : <svg aria-hidden="true" className="h-5 w-5 text-slate-300" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12" /></svg>}</span></span> : cartHasItems ? <span className="flex w-full max-w-2xl items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2"><strong className="truncate text-left text-[17px] font-extrabold" ref={cartSummaryRef}>장바구니</strong><span className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-xs font-bold tabular-nums">{draftQuantityTotal}개</span></span><strong className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[17px] font-extrabold tabular-nums">{money(draftOrderAmount)}원<svg aria-hidden="true" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></strong></span> : <span aria-hidden="true" className="h-1 w-10 shrink-0 rounded-full bg-white/90" />}
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3" id="hos-cart-panel-content" style={{ WebkitOverflowScrolling: "touch" }}>
          {draft.length ? <div className="mx-auto w-full max-w-2xl divide-y divide-slate-100">{draft.map((item, index) => {
            const menu = catalog?.menus.find(candidate => candidate.menuId === item.menuId);
            const optionAmount = item.options.reduce((sum, option) => sum + Number(catalog?.modifiers.find(candidate => candidate.modifierOptionId === option.modifierOptionId)?.priceDelta ?? 0) * option.qty, 0);
            const itemAmount = (Number(menu?.price ?? 0) + optionAmount) * item.qty;
            const optionNames = item.options.map(option => catalog?.modifiers.find(candidate => candidate.modifierOptionId === option.modifierOptionId)?.optionName).filter(Boolean);
            return <article className="py-3" key={`${item.menuId}-${index}`}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-baseline gap-1">
                    <strong className="min-w-0 truncate text-base font-bold text-slate-900" title={item.name}>{item.name}</strong>
                    {optionNames.length > 0 && <span className="min-w-0 truncate text-[13px] leading-tight text-slate-400" title={optionNames.join(" · ")}>{optionNames.join(" · ")}</span>}
                  </div>
                  <span className="mt-1 block text-sm font-semibold text-slate-600">{money(itemAmount)}</span>
                </div>
                <div className="flex items-center gap-1"><button aria-label={`${item.name} 수량 감소`} className="size-9 rounded-lg bg-slate-100 text-[21px] font-bold" onClick={() => changeDraftQuantity(index, -1)} type="button">−</button><strong className="min-w-5 text-center text-[15px] tabular-nums">{money(item.qty)}</strong><button aria-label={`${item.name} 수량 증가`} className="size-9 rounded-lg bg-slate-100 text-[21px] font-bold disabled:opacity-40" disabled={item.qty >= 1000} onClick={() => changeDraftQuantity(index, 1)} type="button">+</button></div>
                <button aria-label={`${item.name} 삭제`} className="flex size-9 items-center justify-center rounded-lg text-slate-400 active:bg-red-50 active:text-red-600" onClick={() => removeDraftItem(index)} type="button"><svg aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg></button>
              </div>
            </article>;
          })}</div> : <p className="flex min-h-40 items-center justify-center text-sm font-medium text-slate-400">장바구니가 비어 있습니다.</p>}
        </div>
        <footer className="shrink-0 border-t border-slate-200 bg-[#F3F5F8] px-4">
          <div className="mx-auto flex min-h-[4.5rem] w-full max-w-2xl">
            <button aria-label={"\uBE44\uC6B0\uAE30"} className={`flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 bg-transparent transition-colors active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gray-500 ${!cartHasItems || busy ? "text-slate-400" : "text-slate-500"}`} disabled={!cartHasItems || busy} onClick={() => { if (window.confirm("\uC7A5\uBC14\uAD6C\uB2C8\uB97C \uBAA8\uB450 \uBE44\uC6B0\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?")) clearDraftImmediately(); }} type="button">
              <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 5v5m4-5v5" /></svg>
              <span className="text-[11px] font-normal leading-tight">{"\uBE44\uC6B0\uAE30"}</span>
            </button>
            <button aria-label="주문전송" className={`flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 bg-transparent transition-colors active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gray-500 ${!cartHasItems || busy ? "text-slate-400" : "text-blue-700"}`} disabled={!cartHasItems || busy} onClick={() => void sendChanges({ returnToDetailAfterOrder: true })} type="button">
              <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
              <span className="text-[11px] font-normal leading-tight">{busy ? "전송 중…" : "주문전송"}</span>
            </button>
          </div>
        </footer>
      </section>
    </>}

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
    {leaveCartConfirmTarget && <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 p-4" onClick={closeLeaveCartConfirmation}>
      <section aria-labelledby="hos-leave-cart-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="alertdialog">
        <h2 className="text-lg font-extrabold text-slate-800" id="hos-leave-cart-title">장바구니를 비울까요?</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">장바구니를 비우면 담아둔 메뉴가 삭제됩니다.</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="min-h-12 min-w-0 rounded-xl border border-[#F8B4B4] bg-[#FFF0F0] px-2 text-sm font-bold text-[#DC2626]" disabled={busy} onClick={discardDraftAndLeave} type="button">비우고 나가기</button>
          <button autoFocus className="min-h-12 min-w-0 rounded-xl bg-[#1855DF] px-2 text-sm font-bold text-white" onClick={closeLeaveCartConfirmation} type="button">계속 주문</button>
        </div>
      </section>
    </div>}
    {logoutConfirmOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4">
      <section aria-labelledby="hos-logout-title" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" role="alertdialog">
        <h2 className="text-lg font-extrabold text-slate-800" id="hos-logout-title">{"\uB85C\uADF8\uC544\uC6C3"}</h2>
        <p className="mt-2 text-sm text-slate-600">{"\uB85C\uADF8\uC544\uC6C3\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C?"}</p>
        {logoutError && <p className="mt-2 text-sm text-red-600" role="alert">{logoutError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button autoFocus className="min-h-12 rounded-xl bg-slate-100 font-bold text-slate-700 disabled:opacity-50" disabled={busy} onClick={() => { setLogoutConfirmOpen(false); setLogoutError(""); }} type="button">{"\uCDE8\uC18C"}</button>
          <button className="min-h-12 rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void logout()} type="button">{busy ? "\uCC98\uB9AC \uC911\u2026" : "\uB85C\uADF8\uC544\uC6C3"}</button>
        </div>
      </section>
    </div>}
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
