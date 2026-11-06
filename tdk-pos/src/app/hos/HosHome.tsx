"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getMenuChoice } from "@/lib/menu-choice-selection";
import { clampHosRemainingQuantity, getHosCancellationQuantity } from "@/lib/hos-order-quantity";
import { getHosMenuCategoryAtTop } from "@/lib/hos-menu-scroll";
import { menuCategoryDisplayName } from "@/lib/menu-category-display";
import HosTableCanvas from "./HosTableCanvas";

type TableRow = {
  tableId: number; tableNo: string; tableName: string | null; positionX: number; positionY: number;
  layoutWidth: number; layoutHeight: number; isVisible: boolean; sessionId: number | null;
  amountDue: number; personCount?: number | null; babyCount?: number | null; openedAt?: string | null; hasQrOrder?: boolean; hasTableToken?: boolean; mergedSourceTableNos: string[];
  isMergedSource: boolean; mergedIntoTableNo: string | null;
};
type OrderItem = {
  orderItemId: number; menuId: number | null; parentOrderItemId: number | null; itemType: string;
  itemName: string; qty: number; unitPrice: string; totalAmount: string; effectiveQty: number; cancelledQty: number; status: string;
  options: Array<{ optionName: string; qty: number; unitPrice: string }>;
};
type TableDetail = {
  table: { tableId: number; tableNo: string; tableName: string | null };
  session: { sessionId: number; relatedSessionIds: number[] } | null;
  orders: Array<{ orderId: number; status: string; orderedAt: string; totalAmount: string; items: OrderItem[] }>;
};
type Menu = { menuId: number; categoryId: number | null; name: string; price: string; categoryName: string | null };
type Modifier = { menuId: number; modifierGroupId: number; groupName: string; choiceDefaultOptionId: number | null;
  modifierOptionId: number; optionName: string; priceDelta: string; optionSortOrder: number };
type Component = { menuComponentId: number; menuId: number; componentMenuId: number; itemName: string; quantity: number };
type Catalog = { menus: Menu[]; categories: Array<{ categoryId: number; name: string }>; modifiers: Modifier[]; components: Component[] };
type DraftItem = { menuId: number; name: string; qty: number; options: Array<{ modifierOptionId: number; qty: number }>; components: Array<{ menuComponentId: number; qty: number }> };
type PendingCancel = { orderItemId: number; keepQty: number };

const money = (amount: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(amount);
async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body) {
    const message = (body as { message?: string } | null)?.message;
    throw new Error(message || `요청에 실패했습니다. (HTTP ${response.status})`);
  }
  return body;
}

export default function HosHome({ staffLoginId }: { staffLoginId: string | null }) {
  const router = useRouter();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [dividerPositions, setDividerPositions] = useState<number[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [screen, setScreen] = useState<"tables" | "detail" | "menu">("tables");
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [cancellations, setCancellations] = useState<PendingCancel[]>([]);
  const [pendingTableId, setPendingTableId] = useState<number | null>(null);
  const [cancelMode, setCancelMode] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelPin, setCancelPin] = useState("");
  const [cancelReauthRequired, setCancelReauthRequired] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("고객 요청");
  const [cancellationDetail, setCancellationDetail] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const sendLock = useRef(false);
  const tableRequestRef = useRef<Promise<void> | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const tableScreenRef = useRef<HTMLElement | null>(null);
  const menuTabsRef = useRef<HTMLDivElement | null>(null);
  const menuListRef = useRef<HTMLDivElement | null>(null);
  const menuSectionRefs = useRef(new Map<number, HTMLElement>());
  const menuTabRefs = useRef(new Map<number | null, HTMLButtonElement>());
  const programmaticMenuScrollRef = useRef(false);
  const menuScrollReleaseTimerRef = useRef<number | null>(null);

  const loadTables = useCallback((manual = false) => {
    if (manual) setManualRefreshing(true);
    if (tableRequestRef.current) return tableRequestRef.current;
    setRefreshing(true);
    const request = (async () => {
      try {
        const result = await readJson<{ tables: TableRow[]; dividerPositions?: number[] }>(await fetch("/api/hos/tables", { cache: "no-store" }));
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
    const result = await readJson<Catalog>(await fetch("/api/hos/menu-catalog", { cache: "no-store" }));
    setCatalog(result);
  }, []);

  const refreshDetail = useCallback(async (tableId: number) => {
    try {
      const response = await readJson<TableDetail>(await fetch(`/api/hos/tables/${tableId}`, { cache: "no-store" }));
      setDetail(response);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "주문 내역을 새로 고치지 못했습니다."); }
  }, []);

  const activeTableId = detail?.table.tableId ?? null;
  useEffect(() => {
    if (screen !== "detail" || activeTableId === null) return;
    const tableId = activeTableId;
    const timer = window.setInterval(() => void refreshDetail(tableId), 5000);
    return () => window.clearInterval(timer);
  }, [activeTableId, refreshDetail, screen]);

  async function openTable(table: TableRow) {
    const hasPendingChanges = draft.length > 0 || cancellations.length > 0;
    if (hasPendingChanges && pendingTableId !== table.tableId) {
      setError("미전송 주문 변경사항이 있습니다. 같은 테이블로 돌아가 주문완료하거나 취소해 주세요.");
      return;
    }
    setBusy(true); setError("");
    if (pendingTableId !== table.tableId) {
      setDraft([]); setCancellations([]); setCancelMode(false); setPendingTableId(null);
    }
    setCancelReauthRequired(false); setCancelPin("");
    try {
      const response = await readJson<TableDetail>(await fetch(`/api/hos/tables/${table.tableId}`, { cache: "no-store" }));
      setDetail(response); setScreen("detail");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "주문 내역을 불러오지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function openMenuPicker() {
    if (cancelMode) {
      setCancelMode(false);
      setCancellations([]);
      if (!draft.length) setPendingTableId(null);
    }
    try {
      if (!catalog) await loadCatalog();
      setError(""); setActiveCategoryId(null); setScreen("menu");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "메뉴를 불러오지 못했습니다."); }
  }

  function chooseMenu(menu: Menu) {
    if (!catalog) return;
    const modifiers = catalog.modifiers.filter(item => item.menuId === menu.menuId);
    const choice = getMenuChoice(modifiers);
    const defaults: Record<number, number> = {};
    if (choice.selected) defaults[choice.selected.modifierGroupId] = choice.selected.modifierOptionId;
    setSelectedMenu(menu); setQuantity(1); setChoices(defaults); setError("");
  }

  function addDraft() {
    if (!catalog || !selectedMenu) return;
    const modifiers = catalog.modifiers.filter(item => item.menuId === selectedMenu.menuId);
    const choice = getMenuChoice(modifiers);
    const choiceId = choice.selected ? choices[choice.selected.modifierGroupId] : undefined;
    const selectedOptions = Number.isSafeInteger(choiceId) ? [{ modifierOptionId: choiceId!, qty: 1 }] : [];
    const components = catalog.components.filter(item => item.menuId === selectedMenu.menuId)
      .map(item => ({ menuComponentId: item.menuComponentId, qty: item.quantity * quantity }));
    setDraft(current => [...current, { menuId: selectedMenu.menuId, name: selectedMenu.name, qty: quantity,
      options: selectedOptions, components }]);
    setPendingTableId(detail?.table.tableId ?? null);
    setSelectedMenu(null); setScreen("detail"); setError("");
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

  async function sendChanges(cancellationPin?: string) {
    const cancellationRequests = cancellations.map(item => {
      const orderItem = orderItems.find(candidate => candidate.orderItemId === item.orderItemId);
      return orderItem ? { orderItemId: item.orderItemId,
        qty: getHosCancellationQuantity(orderItem.effectiveQty, item.keepQty) } : null;
    }).filter((item): item is { orderItemId: number; qty: number } => item !== null && item.qty > 0);
    const submittingCancellations = cancelMode && cancellationRequests.length > 0;
    if (!detail || busy || sendLock.current || (cancelMode && !submittingCancellations) || (!cancelMode && !draft.length)) return;
    sendLock.current = true; setBusy(true); setError("");
    try {
      if (submittingCancellations) {
        const response = await fetch("/api/order-items/cancellations/batch", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentSessionId: detail.session?.sessionId,
            ...(cancellationPin && staffLoginId ? { loginId: staffLoginId, pin: cancellationPin } : {}),
            reason: cancellationReason, detail: cancellationDetail.trim(),
            cancellations: cancellationRequests }),
        });
        const result = await response.json().catch(() => null) as { success?: boolean; reauth?: boolean; message?: string } | null;
        if (response.status === 401 && result?.reauth && !cancellationPin) {
          setCancelReauthRequired(true);
          return;
        }
        if (!response.ok || !result?.success) throw new Error(result?.message || `취소 전송에 실패했습니다. (HTTP ${response.status})`);
      } else {
        let sessionId = detail.session?.sessionId;
        if (!sessionId) {
          const created = await readJson<{ sessionId: number }>(await fetch("/api/table-sessions", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tableId: detail.table.tableId, personCount: 0, babyCount: 0 }),
          }));
          sessionId = created.sessionId;
          setDetail(current => current ? { ...current,
            session: { sessionId: created.sessionId, relatedSessionIds: [created.sessionId] } } : current);
        }
        await readJson(await fetch(`/api/table-sessions/${sessionId}/orders`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: draft.map(item => ({ menuId: item.menuId, qty: item.qty, isComplimentary: false,
            options: item.options, components: item.components })) }),
        }));
      }
      if (!submittingCancellations) setDraft([]);
      setCancellations([]); setPendingTableId(submittingCancellations && draft.length ? detail.table.tableId : null);
      setDetail(null); setScreen("tables");
      setCancelMode(false); setCancelPin(""); setCancelReauthRequired(false);
      await loadTables();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "변경 내용을 전송하지 못했습니다."); }
    finally { setBusy(false); sendLock.current = false; }
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
    setCancelMode(false); setPendingTableId(null); setDetail(null); setScreen("tables"); setError("");
    await loadTables();
  }

  function returnToTables() {
    setDetail(null); setScreen("tables"); setError("");
    void loadTables();
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/hos/auth/logout", { method: "POST" });
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
  const nonEmptyMenuSections = menuSections.filter(section => section.menus.length > 0);
  const categorizedMenuIds = new Set(nonEmptyMenuSections.flatMap(section => section.menus.map(menu => menu.menuId)));
  const uncategorizedMenus = (catalog?.menus ?? []).filter(menu => !categorizedMenuIds.has(menu.menuId));
  const menuSectionsForDisplay = [...nonEmptyMenuSections,
    ...(uncategorizedMenus.length ? [{ categoryId: -1, name: "", displayName: "", menus: uncategorizedMenus }] : [])];

  function releaseProgrammaticMenuScroll(delay = 140) {
    if (menuScrollReleaseTimerRef.current !== null) window.clearTimeout(menuScrollReleaseTimerRef.current);
    menuScrollReleaseTimerRef.current = window.setTimeout(() => {
      programmaticMenuScrollRef.current = false;
      menuScrollReleaseTimerRef.current = null;
    }, delay);
  }

  function scrollToMenuCategory(categoryId: number | null) {
    setActiveCategoryId(categoryId);
    const list = menuListRef.current;
    if (!list) return;
    programmaticMenuScrollRef.current = true;
    if (categoryId === null) {
      list.scrollTo({ top: 0, behavior: "smooth" });
      releaseProgrammaticMenuScroll(700);
      return;
    }
    const target = menuSectionRefs.current.get(categoryId);
    if (!target) {
      releaseProgrammaticMenuScroll(250);
      return;
    }
    const top = list.scrollTop + target.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    releaseProgrammaticMenuScroll(900);
  }

  function syncMenuCategoryFromScroll() {
    const list = menuListRef.current;
    if (!list || programmaticMenuScrollRef.current) {
      if (programmaticMenuScrollRef.current) releaseProgrammaticMenuScroll(140);
      return;
    }
    if (list.scrollTop <= 1) {
      setActiveCategoryId(null);
      return;
    }
    const listTop = list.getBoundingClientRect().top;
    const positions = menuSectionsForDisplay.map(section => ({
      categoryId: section.categoryId,
      top: (menuSectionRefs.current.get(section.categoryId)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) - listTop,
    })).filter(section => Number.isFinite(section.top));
    const nextCategoryId = getHosMenuCategoryAtTop(positions, 8);
    setActiveCategoryId(nextCategoryId === -1 ? null : nextCategoryId);
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

  useEffect(() => () => {
    if (menuScrollReleaseTimerRef.current !== null) window.clearTimeout(menuScrollReleaseTimerRef.current);
  }, []);

  return <main className="flex min-h-dvh flex-col bg-white pb-[env(safe-area-inset-bottom)] text-slate-900" ref={mainRef}>
    {screen === "tables" ? <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-1 text-slate-900">
      <div className="flex min-w-0 flex-col items-start leading-tight">
        <strong className="shrink-0 text-lg font-extrabold text-[#2563EB]">TDK HOS</strong>
        <span className="mt-0.5 max-w-full break-all text-xs leading-tight text-slate-400">{staffLoginId ?? ""}</span>
      </div>
      <button className="min-h-11 min-w-11 shrink-0 bg-transparent px-3 text-[11px] font-medium text-slate-600" disabled={busy} onClick={() => void logout()} type="button">로그아웃</button>
    </header> : screen === "detail" ? <header className="sticky top-0 z-20 bg-white px-3 text-slate-900">
      <div className="flex min-h-12 items-center border-b border-slate-200">
        <button aria-label="테이블 배치로 돌아가기" className="flex min-h-11 min-w-11 items-center gap-1.5 bg-transparent pr-2 text-2xl font-bold text-slate-700" onClick={returnToTables} type="button"><svg aria-hidden="true" className="size-6 shrink-0" fill="none" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" /></svg><span>주문</span></button>
      </div>
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-slate-200 py-1">
        <span className="text-sm font-normal text-slate-500">TNo.<strong className="ml-1 font-extrabold text-slate-900">{detail?.table.tableNo}</strong></span>
        <strong className="text-right text-sm font-extrabold text-slate-900">{money(orderAmount)}</strong>
      </div>
    </header> : <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white px-3">
      <button className="min-h-11 rounded-lg px-2 text-sm font-bold text-slate-700 active:bg-slate-100" onClick={() => setScreen("detail")} type="button">← 주문내역</button>
      <strong className="text-base">메뉴 선택</strong>
    </header>}
    {error && <div className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{error}</div>}

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
        <section aria-labelledby="confirmed-orders-title">
          <h2 className="mb-2 text-sm font-bold text-slate-500" id="confirmed-orders-title">기존 주문내역</h2>
          {orderItems.length ? <div className="divide-y divide-slate-100">
            {orderItems.map(item => {
              const pending = cancellations.find(row => row.orderItemId === item.orderItemId);
              const keepQty = pending?.keepQty ?? item.effectiveQty;
              const canCancel = cancelMode && ["OPEN", "ACCEPTED"].includes(item.orderStatus) && item.status !== "CANCELLED";
              const displayQty = cancelMode && canCancel ? keepQty : item.effectiveQty;
              const itemAmount = Number(item.unitPrice || 0) * displayQty;
              const optionNames = item.options.map(option => `${option.optionName}${option.qty > 1 ? ` ×${option.qty}` : ""}`);
              return <article className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-3 ${pending && keepQty < item.effectiveQty ? "bg-red-50" : ""}`} key={item.orderItemId}>
                <div className="min-w-0">
                  <strong className="block break-words text-[15px] font-bold text-slate-900">{item.itemName}</strong>
                  {optionNames.length > 0 && <p className="mt-0.5 break-words text-xs text-slate-500">{optionNames.join(" · ")}</p>}
                  {pending && keepQty < item.effectiveQty && <p className="mt-0.5 text-xs font-medium text-red-600">{item.effectiveQty - keepQty}개 취소 예정</p>}
                  {cancelMode && !canCancel && <p className="mt-0.5 text-xs text-slate-400">취소 불가</p>}
                </div>
                <div className="min-w-12 text-right">
                  {canCancel ? <div aria-label={`${item.itemName} 남길 수량`} className="flex items-center gap-1">
                    <button aria-label={`${item.itemName} 남길 수량 감소`} className="size-9 rounded-lg bg-slate-100 text-lg font-bold disabled:opacity-40" disabled={keepQty <= 0} onClick={() => changeKeepQuantity(item, -1)} type="button">−</button>
                    <strong className="min-w-5 text-center text-sm">{money(keepQty)}</strong>
                    <button aria-label={`${item.itemName} 남길 수량 증가`} className="size-9 rounded-lg bg-slate-100 text-lg font-bold disabled:opacity-40" disabled={keepQty >= item.effectiveQty} onClick={() => changeKeepQuantity(item, 1)} type="button">+</button>
                  </div> : <span className="text-right text-sm font-semibold text-slate-700">{money(item.effectiveQty)}</span>}
                </div>
                <strong className="min-w-[4.5rem] text-right text-sm font-semibold text-slate-800">{money(itemAmount)}</strong>
              </article>;
            })}
          </div> : <p className="py-3 text-sm text-slate-400">확정된 주문이 없습니다.</p>}
          {cancelMode && cancellationRequests.length > 0 && <div className="mt-2 rounded-lg bg-slate-50 p-3">
            <label className="block text-sm font-bold text-slate-700">취소 사유
              <select className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" onChange={event => setCancellationReason(event.target.value)} value={cancellationReason}>
                {["고객 요청", "주문 실수", "조리 불량", "이물질", "에러", "기타"].map(reason => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            {cancellationReason === "기타" && <input className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3" onChange={event => setCancellationDetail(event.target.value)} placeholder="취소 사유를 입력해 주세요" value={cancellationDetail} />}
          </div>}
        </section>

        <div aria-hidden="true" className="my-4 h-[2px] w-full bg-[#D9DEE5]" />

        <section aria-labelledby="cart-title">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-700" id="cart-title">장바구니</h2>
            {draft.length > 0 && <span className="text-xs text-slate-500">합계 {money(draftOrderAmount)}</span>}
          </div>
          {draft.length ? <div className="divide-y divide-slate-100">
            {draft.map((item, index) => {
              const menu = catalog?.menus.find(candidate => candidate.menuId === item.menuId);
              const optionAmount = item.options.reduce((sum, option) => sum + Number(catalog?.modifiers.find(candidate => candidate.modifierOptionId === option.modifierOptionId)?.priceDelta ?? 0) * option.qty, 0);
              const itemAmount = (Number(menu?.price ?? 0) + optionAmount) * item.qty;
              const optionNames = item.options.map(option => catalog?.modifiers.find(candidate => candidate.modifierOptionId === option.modifierOptionId)?.optionName).filter(Boolean);
              return <article className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-3" key={`${item.menuId}-${index}`}>
                <div className="min-w-0"><span className="mb-0.5 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">신규</span><strong className="block break-words text-[15px] font-bold">{item.name}</strong>
                  {optionNames.length > 0 && <p className="mt-0.5 break-words text-xs text-slate-500">{optionNames.join(" · ")}</p>}</div>
                <div className="flex items-center gap-1">
                  <button aria-label={`${item.name} 장바구니 수량 감소`} className="size-9 rounded-lg bg-slate-100 text-lg font-bold" onClick={() => changeDraftQuantity(index, -1)} type="button">−</button>
                  <strong className="min-w-5 text-center text-sm">{money(item.qty)}</strong>
                  <button aria-label={`${item.name} 장바구니 수량 증가`} className="size-9 rounded-lg bg-slate-100 text-lg font-bold" disabled={item.qty >= 1000} onClick={() => changeDraftQuantity(index, 1)} type="button">+</button>
                </div>
                <strong className="min-w-[4.5rem] text-right text-sm font-semibold">{money(itemAmount)}</strong>
              </article>;
            })}
          </div> : <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-400">추가한 메뉴가 없습니다.</p>}
        </section>
      </div>
      <div className="sticky bottom-0 grid grid-cols-3 gap-2 border-t border-slate-200 bg-white/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button className="min-h-14 rounded-xl bg-violet-600 text-sm font-extrabold text-white disabled:opacity-50" disabled={busy} onClick={() => void completeOrder()} type="button">주문</button>
        <button className={`min-h-14 rounded-xl text-sm font-extrabold text-white disabled:opacity-50 ${cancelMode ? "bg-red-700" : "bg-red-600"}`} disabled={busy || (!cancelMode && !cancellableItems.length)} onClick={() => {
          if (cancelMode) {
            setCancelMode(false); setCancellations([]);
            if (!draft.length) setPendingTableId(null);
          } else {
            setCancellations([]); setCancelMode(true);
            if (detail) setPendingTableId(detail.table.tableId);
          }
          setError("");
        }} type="button">취소</button>
        <button className="min-h-14 rounded-xl bg-blue-600 text-sm font-extrabold text-white disabled:opacity-50" disabled={busy} onClick={() => void openMenuPicker()} type="button">추가</button>
      </div>
    </section>}

    {screen === "menu" && catalog && <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-3 pb-3">
      <div aria-label="메뉴 분류" className="-mx-3 flex shrink-0 gap-2 overflow-x-auto border-b border-slate-100 bg-white px-3 py-2" ref={menuTabsRef}>
        <button className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold ${activeCategoryId === null ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => scrollToMenuCategory(null)} ref={element => {
          if (element) menuTabRefs.current.set(null, element); else menuTabRefs.current.delete(null);
        }} type="button">전체</button>
        {menuSections.map(item => <button className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold ${activeCategoryId === item.categoryId ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} key={item.categoryId} onClick={() => scrollToMenuCategory(item.categoryId)} ref={element => {
          if (element) menuTabRefs.current.set(item.categoryId, element); else menuTabRefs.current.delete(item.categoryId);
        }} type="button">{item.displayName}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth pb-2" onScroll={syncMenuCategoryFromScroll} ref={menuListRef}>
        {menuSectionsForDisplay.map(section => <div data-menu-category-section={section.categoryId} key={section.categoryId} ref={element => {
          if (element) menuSectionRefs.current.set(section.categoryId, element); else menuSectionRefs.current.delete(section.categoryId);
        }}>
          {section.menus.map(menu => <button className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-slate-100 bg-white px-1 py-3 text-left active:bg-blue-50" key={menu.menuId} onClick={() => chooseMenu(menu)} type="button"><span className="font-bold">{menu.name}</span><span className="shrink-0 text-sm font-semibold text-slate-600">{money(Number(menu.price))}</span></button>)}
          <div aria-hidden="true" className="my-4 h-[4px] w-full bg-[#D9DEE5]" />
        </div>)}
        <div aria-hidden="true" className="h-[50vh]" />
      </div>
      <div className="sticky bottom-0 bg-white py-2"><button className="min-h-14 w-full rounded-xl bg-slate-800 font-extrabold text-white" onClick={() => setScreen("detail")} type="button">주문내역으로 돌아가기</button></div>
    </section>}

    {selectedMenu && catalog && <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/50 p-2 sm:items-center" onClick={() => setSelectedMenu(null)}>
      <section aria-modal="true" className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="dialog">
        <h2 className="text-xl font-extrabold">{selectedMenu.name}</h2><p className="mt-1 text-slate-600">{money(Number(selectedMenu.price))}</p>
        {(() => {
          const choice = getMenuChoice(catalog.modifiers.filter(item => item.menuId === selectedMenu.menuId));
          return choice.options.length > 0 && <fieldset className="mt-4"><legend className="mb-2 text-sm font-bold">{choice.title}</legend><div className="grid grid-cols-2 gap-2">{choice.options.map(option => <button className={`min-h-12 rounded-lg px-3 text-sm font-bold ${choices[option.modifierGroupId] === option.modifierOptionId ? "bg-blue-600 text-white" : "bg-slate-100"}`} key={option.modifierOptionId} onClick={() => setChoices(current => ({ ...current, [option.modifierGroupId]: option.modifierOptionId }))} type="button">{option.optionName}{Number(option.priceDelta) ? ` (${money(Number(option.priceDelta))})` : ""}</button>)}</div></fieldset>;
        })()}
        <div className="mt-5 flex items-center justify-center gap-5"><button className="size-12 rounded-xl bg-slate-100 text-2xl" onClick={() => setQuantity(value => Math.max(1, value - 1))} type="button">−</button><strong className="text-xl">{quantity}</strong><button className="size-12 rounded-xl bg-slate-100 text-2xl" onClick={() => setQuantity(value => Math.min(1000, value + 1))} type="button">+</button></div>
        <div className="mt-5 grid grid-cols-2 gap-2"><button className="min-h-12 rounded-xl bg-slate-100 font-bold" onClick={() => setSelectedMenu(null)} type="button">닫기</button><button className="min-h-12 rounded-xl bg-blue-600 font-extrabold text-white" onClick={addDraft} type="button">추가 예정에 담기</button></div>
      </section>
    </div>}
    {cancelReauthRequired && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
      <section aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" role="alertdialog">
        <h2 className="text-lg font-extrabold">전체 취소 확인</h2>
        <p className="mt-2 text-sm text-slate-600">전체 주문 취소에는 현재 로그인 직원의 PIN 확인이 필요합니다.</p>
        <input autoFocus autoComplete="current-password" className="mt-4 min-h-14 w-full rounded-xl border border-slate-300 text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} onChange={event => setCancelPin(event.target.value.replace(/\D/g, "").slice(0, 6))} type="password" value={cancelPin} />
        {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2"><button className="min-h-12 rounded-xl bg-slate-100 font-bold" onClick={() => { setCancelReauthRequired(false); setCancelPin(""); setError(""); }} type="button">취소</button><button className="min-h-12 rounded-xl bg-red-600 font-bold text-white disabled:opacity-40" disabled={busy || cancelPin.length !== 6} onClick={() => void sendChanges(cancelPin)} type="button">확인 후 전송</button></div>
      </section>
    </div>}
  </main>;
}
