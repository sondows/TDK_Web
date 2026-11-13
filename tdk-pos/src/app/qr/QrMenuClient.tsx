"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import Image from "next/image";
import { getMenuChoice } from "@/lib/menu-choice-selection";
import { addQrCartLine, defaultQrSelections, groupQrModifiers, normalizeQrCart, qrCartTotal,
  QR_CART_STORAGE_KEY, qrLineUnitPrice, qrLocaleFromPreferences,
  selectedQrOptions, validQrSelections, type QrCartLine, type QrCatalog, type QrLocale, type QrMenu } from "@/lib/qr-menu-cart";
import { acknowledgeQrCartEvents, appendQrCartEvents, normalizeQrCartEventOutbox, QR_CART_EVENT_BATCH_SIZE, QR_CART_EVENT_OUTBOX_KEY,
  qrCartEventSourceFromSearch, type QrCartAnalyticsEvent, type QrCartEventSource, type QrCartEventType } from "@/lib/qr-cart-analytics";
import QrStoreTitle from "./QrStoreTitle";
import QrTitleCarousel from "./QrTitleCarousel";
import { qrTitleHeroOverlap, qrTitleInitialCardTop, qrTitleInitialScroll, type QrPublicTitleSettings } from "@/lib/qr-title-model";
import type { QrPublicNotice } from "@/lib/qr-notice-model";

const copy: Record<QrLocale, Record<string, string>> = {
  ko: { title: "메뉴", cart: "장바구니", count: "개", empty: "장바구니가 비어 있습니다.", add: "장바구니에 담기", close: "닫기", qty: "수량", total: "예상 합계", estimate: "예상 금액이며 주문 또는 결제가 확정된 금액이 아닙니다.", remove: "삭제", required: "필수", optional: "선택", none: "선택 안 함", loading: "메뉴를 불러오는 중입니다.", error: "메뉴를 불러오지 못했습니다.", networkError: "네트워크 연결을 확인해 주세요.", invalidError: "메뉴 서버 응답을 확인할 수 없습니다.", retry: "다시 시도", noMenus: "이 분류에 표시할 메뉴가 없습니다.", noImage: "메뉴 사진", optionPrice: "추가", language: "언어" },
  en: { title: "Menu", cart: "Cart", count: "items", empty: "Your cart is empty.", add: "Add to cart", close: "Close", qty: "Qty", total: "Estimated total", estimate: "Estimate only. This is not a confirmed order or payment.", remove: "Remove", required: "Required", optional: "Optional", none: "No selection", loading: "Loading menu…", error: "Could not load the menu.", networkError: "Check your network connection.", invalidError: "The menu server returned an invalid response.", retry: "Try again", noMenus: "No items in this category.", noImage: "Menu photo", optionPrice: "Add", language: "Language" },
  "zh-CN": { title: "菜单", cart: "购物车", count: "份", empty: "购物车为空。", add: "加入购物车", close: "关闭", qty: "数量", total: "预计合计", estimate: "仅供参考，不代表订单或付款已确认。", remove: "删除", required: "必选", optional: "可选", none: "不选择", loading: "正在加载菜单…", error: "无法加载菜单。", networkError: "请检查网络连接。", invalidError: "菜单服务器返回了无效数据。", retry: "重试", noMenus: "此分类暂无菜单。", noImage: "菜品图片", optionPrice: "加价", language: "语言" },
  ja: { title: "メニュー", cart: "カート", count: "点", empty: "カートは空です。", add: "カートに入れる", close: "閉じる", qty: "数量", total: "合計目安", estimate: "目安金額です。注文・決済は確定していません。", remove: "削除", required: "必須", optional: "任意", none: "選択しない", loading: "メニューを読み込み中…", error: "メニューを読み込めませんでした。", networkError: "ネットワーク接続を確認してください。", invalidError: "メニューサーバーの応答を確認できません。", retry: "再試行", noMenus: "このカテゴリにメニューはありません。", noImage: "料理写真", optionPrice: "追加", language: "言語" },
};
const QR_WAIT_ORDER_ID_KEY = "tdkon:qr-wait-order-id:v1";
type WaitOrder = { waitOrderId: number; publicReference: string; status: string; version: number; estimatedTotal: string; items: Array<{ menuId: number; itemName: string; quantity: number; options: QrCartLine["options"] }> };
type ApiCatalog = { categories: Array<{ categoryId: number; name: string; tabColor: string | null }>; menus: Array<Omit<QrMenu, "groups">>; modifierGroups: Array<{ menuId: number; modifierGroupId: number; name: string; minSelect: number; maxSelect: number; isRequired: boolean; defaultOptionId: number | null; modifierOptionId: number; optionName: string; priceDelta: string; groupSortOrder: number; optionSortOrder: number }> };
type CatalogError = { kind: "http"; status: number } | { kind: "network" | "invalid" } | null;

function won(value: number, locale: QrLocale = "ko") {
  const numberLocale = locale === "zh-CN" ? "zh-CN" : locale;
  return new Intl.NumberFormat(numberLocale, { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(Math.round(value));
}

function hosDefaultSelections(groups: QrMenu["groups"]) {
  const selections = defaultQrSelections(groups);
  for (const group of groups) {
    if (group.defaultOptionId === null && group.name !== "매운맛") continue;
    const choice = getMenuChoice(group.options.map(option => ({ modifierGroupId: group.modifierGroupId,
      groupName: group.name, modifierOptionId: option.modifierOptionId, optionName: option.optionName,
      optionSortOrder: option.optionSortOrder, choiceDefaultOptionId: group.defaultOptionId })));
    selections[group.modifierGroupId] = choice.selected ? [choice.selected.modifierOptionId] : [];
  }
  return selections;
}

export default function QrMenuClient({ waitingMode = false, initialTitleData, notices = [] }: { waitingMode?: boolean; initialTitleData: QrPublicTitleSettings; notices?: QrPublicNotice[] }) {
  const [catalog, setCatalog] = useState<QrCatalog | null>(null);
  const [locale, setLocale] = useState<QrLocale>("ko");
  const [catalogError, setCatalogError] = useState<CatalogError>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [cart, setCart] = useState<QrCartLine[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [view, setView] = useState<{ type: "menu"; menuId: number } | null>(null);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [selectionError, setSelectionError] = useState("");
  const [qrSource] = useState<QrCartEventSource>(() => waitingMode ? "WAITING" :
    typeof window === "undefined" ? "FRONT" : qrCartEventSourceFromSearch(window.location.search));
  const [waitOrder, setWaitOrder] = useState<WaitOrder | null>(null);
  const [waitBusy, setWaitBusy] = useState(false);
  const [waitError, setWaitError] = useState("");
  const [editingWaitOrder, setEditingWaitOrder] = useState<{ id: number; version: number } | null>(null);
  const [titleData] = useState(initialTitleData);
  const qrVisitorReady = useRef(false);
  const catalogSnapshotRef = useRef<QrCatalog | null>(null);
  const catalogRefreshInFlightRef = useRef(false);
  const categoryPageChangeRef = useRef(false);
  const categoryTabNavRef = useRef<HTMLElement>(null);
  const categoryTabRefs = useRef(new Map<number, HTMLButtonElement>());
  const cartSheetOpenRef = useRef(false);
  const cartSheetHistoryRef = useRef(false);
  const sheetTouchStartY = useRef<number | null>(null);
  const sheetTouchHandled = useRef(false);
  const analyticsFlushInFlight = useRef(false);
  const analyticsRetryCount = useRef(0);
  const analyticsRetryAt = useRef(0);
  const t = copy[locale];

  useLayoutEffect(() => {
    if (!titleData.photos.length) return;
    const hero = document.querySelector<HTMLElement>("[data-qr-fixed-hero]");
    if (!hero) return;
    const root = document.documentElement;
    const previousOverscroll = root.style.overscrollBehaviorY;
    const main = hero.closest<HTMLElement>("main");
    if (!main) return;
    const previousMinHeight = main.style.minHeight;
    root.style.overscrollBehaviorY = "contain";

    let heroHeight = hero.getBoundingClientRect().height;
    let heroWidth = hero.getBoundingClientRect().width;
    let overlap = qrTitleHeroOverlap(heroWidth);
    let cardTop = qrTitleInitialCardTop(heroHeight);
    const reserveScrollRange = (initialScroll: number) => {
      main.style.minHeight = previousMinHeight;
      // The loading shell may be shorter than the requested offset, so reserve it before scrollTo.
      main.style.minHeight = `${Math.max(main.offsetHeight, window.innerHeight + initialScroll)}px`;
    };
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const initialScroll = qrTitleInitialScroll(heroHeight, overlap, cardTop);
    reserveScrollRange(initialScroll);
    if (navigation?.type !== "back_forward") {
      window.scrollTo(0, initialScroll);
    }

    const resizeObserver = new ResizeObserver(() => {
      const nextHeight = hero.getBoundingClientRect().height;
      if (Math.abs(nextHeight - heroHeight) < 1) return;
      const nextWidth = hero.getBoundingClientRect().width;
      const nextOverlap = qrTitleHeroOverlap(nextWidth);
      const nextCardTop = qrTitleInitialCardTop(nextHeight);
      const currentScroll = window.scrollY;
      const oldInitialScroll = qrTitleInitialScroll(heroHeight, overlap, cardTop);
      const nextInitialScroll = qrTitleInitialScroll(nextHeight, nextOverlap, nextCardTop);
      reserveScrollRange(nextInitialScroll);
      const oldContentTop = heroHeight - overlap;
      const nextContentTop = nextHeight - nextOverlap;
      const oldContentRange = Math.max(1, oldContentTop - oldInitialScroll);
      const nextContentRange = Math.max(1, nextContentTop - nextInitialScroll);
      const nextScroll = currentScroll <= oldInitialScroll
        ? oldInitialScroll ? currentScroll / oldInitialScroll * nextInitialScroll : currentScroll
        : currentScroll <= oldContentTop
          ? nextInitialScroll + (currentScroll - oldInitialScroll) / oldContentRange * nextContentRange
          : currentScroll + nextContentTop - oldContentTop;
      window.scrollTo(0, nextScroll);
      heroHeight = nextHeight;
      heroWidth = nextWidth;
      overlap = nextOverlap;
      cardTop = nextCardTop;
    });
    const onViewportResize = () => reserveScrollRange(qrTitleInitialScroll(heroHeight, overlap, cardTop));
    resizeObserver.observe(hero);
    window.addEventListener("resize", onViewportResize);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", onViewportResize);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      main.style.minHeight = previousMinHeight;
      root.style.overscrollBehaviorY = previousOverscroll;
    };
  }, [titleData.photos.length]);

  useLayoutEffect(() => {
    const content = document.querySelector<HTMLElement>("[data-qr-content]");
    const titleStack = content?.querySelector<HTMLElement>("[data-qr-title-stack]");
    if (!content || !titleStack) return;
    const updateBackdropStart = () => {
      const anchor = content.querySelector<HTMLElement>("[data-qr-menu-background-anchor]");
      if (!anchor) {
        content.style.removeProperty("--qr-menu-backdrop-top");
        return;
      }
      const contentTop = content.getBoundingClientRect().top;
      const anchorRect = anchor.getBoundingClientRect();
      content.style.setProperty("--qr-menu-backdrop-top", `${anchorRect.top - contentTop + anchorRect.height / 2}px`);
    };
    const observer = new ResizeObserver(updateBackdropStart);
    observer.observe(titleStack);
    updateBackdropStart();
    window.addEventListener("resize", updateBackdropStart);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBackdropStart);
      content.style.removeProperty("--qr-menu-backdrop-top");
    };
  }, [titleData.photos.length]);

  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-qr-header]");
    if (!header) return;
    const updateStickySurface = () => {
      if (header.getBoundingClientRect().top <= 0.5) header.dataset.qrStuck = "true";
      else delete header.dataset.qrStuck;
    };
    updateStickySurface();
    window.addEventListener("scroll", updateStickySurface, { passive: true });
    window.addEventListener("resize", updateStickySurface);
    return () => {
      window.removeEventListener("scroll", updateStickySurface);
      window.removeEventListener("resize", updateStickySurface);
      delete header.dataset.qrStuck;
    };
  }, []);

  const closeCartSheet = useCallback((fromHistory = false) => {
    cartSheetOpenRef.current = false;
    setCartSheetOpen(false);
    if (!fromHistory && cartSheetHistoryRef.current) {
      cartSheetHistoryRef.current = false;
      window.history.back();
    } else if (fromHistory) {
      cartSheetHistoryRef.current = false;
    }
  }, []);

  const openCartSheet = useCallback(() => {
    if (cartSheetOpenRef.current) return;
    cartSheetOpenRef.current = true;
    setView(null);
    setCartSheetOpen(true);
    window.history.pushState({ ...(window.history.state ?? {}), tdkQrCartSheet: true }, "", window.location.href);
    cartSheetHistoryRef.current = true;
  }, []);

  const handleCartHeaderTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    sheetTouchStartY.current = event.touches[0]?.clientY ?? null;
    sheetTouchHandled.current = false;
  };

  const handleCartHeaderTouchEnd = (event: ReactTouchEvent<HTMLElement>) => {
    const startY = sheetTouchStartY.current;
    sheetTouchStartY.current = null;
    const endY = event.changedTouches[0]?.clientY;
    if (startY === null || endY === undefined || Math.abs(endY - startY) < 48) return;
    sheetTouchHandled.current = true;
    if (endY < startY) openCartSheet();
    else if (cartSheetOpenRef.current) closeCartSheet();
    window.setTimeout(() => { sheetTouchHandled.current = false; }, 350);
  };

  const toggleCartSheet = () => {
    if (sheetTouchHandled.current) return;
    if (cartSheetOpenRef.current) closeCartSheet();
    else openCartSheet();
  };

  useEffect(() => {
    if (!cartSheetOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCartSheet();
    };
    const onPopState = () => {
      if (cartSheetOpenRef.current) closeCartSheet(true);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onPopState);
    };
  }, [cartSheetOpen, closeCartSheet]);

  useEffect(() => {
    if (!view) return;
    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo(0, scrollY);
    };
  }, [view]);

  const flushAnalytics = useCallback(async () => {
    if (!qrVisitorReady.current || analyticsFlushInFlight.current || Date.now() < analyticsRetryAt.current) return;
    analyticsFlushInFlight.current = true;
    try {
      const raw = localStorage.getItem(QR_CART_EVENT_OUTBOX_KEY);
      const events = normalizeQrCartEventOutbox(raw ? JSON.parse(raw) : []);
      if (!events.length) return;
      const batch = events.slice(0, QR_CART_EVENT_BATCH_SIZE);
      const response = await fetch("/api/qr/cart-events", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: batch }),
        credentials: "same-origin", keepalive: true,
      });
      if (!response.ok) {
        analyticsRetryCount.current = Math.min(analyticsRetryCount.current + 1, 8);
        analyticsRetryAt.current = Date.now() + Math.min(5 * 60_000, 1_000 * (2 ** analyticsRetryCount.current));
        return;
      }
      const result = await response.json() as { success?: boolean; acceptedEventIds?: unknown };
      if (!result.success || !Array.isArray(result.acceptedEventIds)) {
        analyticsRetryCount.current = Math.min(analyticsRetryCount.current + 1, 8);
        analyticsRetryAt.current = Date.now() + Math.min(5 * 60_000, 1_000 * (2 ** analyticsRetryCount.current));
        return;
      }
      analyticsRetryCount.current = 0;
      analyticsRetryAt.current = 0;
      const accepted = result.acceptedEventIds.filter((id): id is string => typeof id === "string");
      const remaining = acknowledgeQrCartEvents(events, accepted);
      if (remaining.length) localStorage.setItem(QR_CART_EVENT_OUTBOX_KEY, JSON.stringify(remaining));
      else localStorage.removeItem(QR_CART_EVENT_OUTBOX_KEY);
    } catch {
      analyticsRetryCount.current = Math.min(analyticsRetryCount.current + 1, 8);
      analyticsRetryAt.current = Date.now() + Math.min(5 * 60_000, 1_000 * (2 ** analyticsRetryCount.current));
    }
    finally { analyticsFlushInFlight.current = false; }
  }, []);

  const queueCartEvent = (eventType: QrCartEventType, menuId: number, optionIds: number[], before: number, after: number) => {
    const delta = after - before;
    if (!delta && eventType !== "MENU_VIEW") return;
    try {
      const event: QrCartAnalyticsEvent = {
        clientEventId: crypto.randomUUID(), source: qrSource, eventType, menuId,
        optionIds: [...new Set(optionIds)].sort((a, b) => a - b), quantityBefore: before,
        quantityDelta: delta, quantityAfter: after, occurredAt: new Date().toISOString(),
      };
      const raw = localStorage.getItem(QR_CART_EVENT_OUTBOX_KEY);
      const next = appendQrCartEvents(normalizeQrCartEventOutbox(raw ? JSON.parse(raw) : []), [event]);
      localStorage.setItem(QR_CART_EVENT_OUTBOX_KEY, JSON.stringify(next));
      void flushAnalytics();
    } catch { /* local storage can be unavailable; cart state still changes */ }
  };

  const loadCatalog = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setCatalogError(null);
    }
    try {
      const response = await fetch("/api/qr/menu-catalog", { cache: "no-store" });
      if (!response.ok) {
        if (!silent) setCatalogError({ kind: "http", status: response.status });
        return;
      }
      const data = await response.json().catch(() => null) as (ApiCatalog & { success?: boolean }) | null;
      if (!data?.success || !Array.isArray(data.menus) || !Array.isArray(data.categories)) {
        if (!silent) setCatalogError({ kind: "invalid" });
        return;
      }
      const menus: QrMenu[] = data.menus.map(menu => ({ ...menu,
        groups: groupQrModifiers(data.modifierGroups ?? [], menu.menuId) }));
      const next = { categories: data.categories, menus };
      catalogSnapshotRef.current = next;
      setCatalog(next);
      setCatalogError(null);
      setSelectedCategoryId(current => current !== null && next.categories.some(category => category.categoryId === current)
        ? current : next.categories[0]?.categoryId ?? null);
    } catch {
      if (!silent) setCatalogError({ kind: "network" });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadCatalog(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog]);
  useEffect(() => {
    if (view !== null) return;
    const refresh = () => {
      if (!catalogSnapshotRef.current || catalogRefreshInFlightRef.current || document.visibilityState === "hidden") return;
      catalogRefreshInFlightRef.current = true;
      void loadCatalog(true).finally(() => { catalogRefreshInFlightRef.current = false; });
    };
    const timer = window.setInterval(refresh, 45_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadCatalog, view]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const key = `tdkon:qr-visit-event:${qrSource}`;
        let clientEventId = sessionStorage.getItem(key) ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(clientEventId)) {
          clientEventId = crypto.randomUUID();
          sessionStorage.setItem(key, clientEventId);
        }
        void fetch("/api/qr/visit", { method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "same-origin", keepalive: true,
          body: JSON.stringify({ source: qrSource, clientEventId }) }).catch(() => undefined).finally(() => {
            qrVisitorReady.current = true;
            void flushAnalytics();
          });
      } catch { /* telemetry cannot interrupt menu browsing */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [qrSource, flushAnalytics]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const languages = navigator.languages?.length ? [...navigator.languages] : [navigator.language];
      setLocale(qrLocaleFromPreferences(languages));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!catalog) return;
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(QR_CART_STORAGE_KEY);
        setCart(normalizeQrCart(raw ? JSON.parse(raw) : [], catalog));
      } catch { setCart([]); }
      setCartReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [catalog]);
  useEffect(() => {
    const flush = () => { if (document.visibilityState === "visible") void flushAnalytics(); };
    const timer = window.setInterval(flush, 20_000);
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", flush);
    void flushAnalytics();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [flushAnalytics]);
  useEffect(() => {
    if (!cartReady) return;
    try { localStorage.setItem(QR_CART_STORAGE_KEY, JSON.stringify(cart)); } catch { /* menu remains usable without persistence */ }
  }, [cart, cartReady]);

  const currentMenu = view?.type === "menu" ? catalog?.menus.find(menu => menu.menuId === view.menuId) ?? null : null;
  const currentCategory = catalog?.categories.find(category => category.categoryId === selectedCategoryId) ?? null;
  const currentCategoryMenus = catalog?.menus.filter(menu => menu.categoryId === selectedCategoryId) ?? [];
  const itemCount = cart.reduce((sum, line) => sum + line.qty, 0);
  const total = catalog ? qrCartTotal(cart, catalog.menus) : 0;
  const openMenu = (menu: QrMenu) => {
    queueCartEvent("MENU_VIEW", menu.menuId, [], 0, 0);
    setSelections(hosDefaultSelections(menu.groups));
    setQuantity(1);
    setSelectionError("");
    setView({ type: "menu", menuId: menu.menuId });
  };
  const scrollCategoryHeaderToTop = useCallback(() => {
    const header = document.querySelector<HTMLElement>("[data-qr-header]");
    if (!header) return;
    const top = Math.max(0, window.scrollY + header.getBoundingClientRect().top);
    const main = header.closest<HTMLElement>("main");
    if (main) main.style.minHeight = `${Math.max(main.offsetHeight, window.innerHeight + top)}px`;
    window.scrollTo(0, top);
  }, []);
  useLayoutEffect(() => {
    if (!categoryPageChangeRef.current) return;
    categoryPageChangeRef.current = false;
    scrollCategoryHeaderToTop();
  }, [selectedCategoryId, scrollCategoryHeaderToTop]);
  useEffect(() => {
    const nav = categoryTabNavRef.current;
    const tab = selectedCategoryId === null ? null : categoryTabRefs.current.get(selectedCategoryId);
    if (!nav || !tab) return;
    const navRect = nav.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const margin = 12;
    let left = nav.scrollLeft;
    if (tabRect.left < navRect.left + margin) left += tabRect.left - navRect.left - margin;
    else if (tabRect.right > navRect.right - margin) left += tabRect.right - navRect.right + margin;
    nav.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [catalog, selectedCategoryId]);
  const selectCategory = (categoryId: number) => {
    if (categoryId === selectedCategoryId) {
      scrollCategoryHeaderToTop();
      return;
    }
    categoryPageChangeRef.current = true;
    setSelectedCategoryId(categoryId);
  };
  const closeView = () => { setView(null); setSelectionError(""); };
  const toggleOption = (groupId: number, optionId: number, multi: boolean, max: number) => {
    setSelectionError("");
    setSelections(current => {
      const existing = current[groupId] ?? [];
      const selected = existing.includes(optionId);
      if (!multi) return { ...current, [groupId]: selected ? [] : [optionId] };
      if (selected) return { ...current, [groupId]: existing.filter(id => id !== optionId) };
      if (existing.length >= max) return current;
      return { ...current, [groupId]: [...existing, optionId] };
    });
  };
  const addCurrentMenu = () => {
    if (!currentMenu || !validQrSelections(currentMenu.groups, selections)) {
      setSelectionError("필수 옵션을 선택해 주세요.");
      return;
    }
    const options = selectedQrOptions(currentMenu.groups, selections);
    setCart(current => addQrCartLine(current, { menuId: currentMenu.menuId, qty: quantity, options }));
    const sameOptions = (candidate: QrCartLine) => candidate.menuId === currentMenu.menuId &&
      JSON.stringify(candidate.options) === JSON.stringify(options);
    const quantityBefore = cart.find(sameOptions)?.qty ?? 0;
    const quantityAfter = Math.min(99, quantityBefore + quantity);
    queueCartEvent("ADD", currentMenu.menuId, options.map(option => option.modifierOptionId), quantityBefore, quantityAfter);
    setView(null);
  };
  const changeCartQty = (line: QrCartLine, delta: number) => {
    const nextQty = Math.max(0, Math.min(99, line.qty + delta));
    if (nextQty === line.qty) return;
    setCart(current => current.flatMap(item => {
      if (item.menuId !== line.menuId || JSON.stringify(item.options) !== JSON.stringify(line.options)) return [item];
      return nextQty === 0 ? [] : [{ ...item, qty: nextQty }];
    }));
    queueCartEvent(nextQty === 0 ? "REMOVE" : delta > 0 ? "INCREASE" : "DECREASE", line.menuId,
      line.options.map(option => option.modifierOptionId), line.qty, nextQty);
  };
  const removeCartLine = (line: QrCartLine) => {
    setCart(current => current.filter(item => item.menuId !== line.menuId || JSON.stringify(item.options) !== JSON.stringify(line.options)));
    queueCartEvent("REMOVE", line.menuId, line.options.map(option => option.modifierOptionId), line.qty, 0);
  };

  const loadWaitOrder = useCallback(async (id: number) => {
    const response = await fetch(`/api/qr/wait-orders/${id}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("wait order unavailable");
    const payload = await response.json() as { success?: boolean; order?: Omit<WaitOrder, "items">; items?: Array<WaitOrder["items"][number]> };
    if (!payload.success || !payload.order || !Array.isArray(payload.items)) throw new Error("invalid wait order");
    const next = { ...payload.order, items: payload.items } as WaitOrder;
    setWaitOrder(next);
    return next;
  }, []);

  useEffect(() => {
    if (!waitingMode) return;
    const timer = window.setTimeout(() => {
      try {
        const id = Number(localStorage.getItem(QR_WAIT_ORDER_ID_KEY));
        if (Number.isSafeInteger(id) && id > 0) void loadWaitOrder(id).catch(() => {
          setWaitOrder(null);
          localStorage.removeItem(QR_WAIT_ORDER_ID_KEY);
        });
      } catch { /* no saved customer order */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [waitingMode, loadWaitOrder]);

  const submitWaitOrder = async () => {
    if (!waitingMode || waitBusy || !cart.length) return;
    setWaitBusy(true);
    setWaitError("");
    try {
      let requestId = "";
      try {
        requestId = localStorage.getItem("tdkon:qr-wait-request-id:v1") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(requestId)) requestId = crypto.randomUUID();
        localStorage.setItem("tdkon:qr-wait-request-id:v1", requestId);
      } catch { requestId = crypto.randomUUID(); }
      const editing = editingWaitOrder;
      const response = await fetch(editing ? `/api/qr/wait-orders/${editing.id}` : "/api/qr/wait-orders", {
        method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify(editing ? { version: editing.version, cart } : { requestId, source: qrSource, cart }),
      });
      const payload = await response.json() as { success?: boolean; waitOrderId?: number; publicReference?: string; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "대기 주문을 저장하지 못했습니다.");
      const id = editing?.id ?? payload.waitOrderId;
      if (!id) throw new Error("대기 주문 번호를 확인하지 못했습니다.");
      try {
        localStorage.setItem(QR_WAIT_ORDER_ID_KEY, String(id));
        localStorage.removeItem("tdkon:qr-wait-request-id:v1");
      } catch { /* same-browser cookie still protects this order */ }
      setCart([]);
      setEditingWaitOrder(null);
      await loadWaitOrder(id);
      setView(null);
    } catch (error) {
      setWaitError(error instanceof Error ? error.message : "대기 주문을 저장하지 못했습니다.");
    } finally { setWaitBusy(false); }
  };

  const editWaitOrder = () => {
    if (!waitOrder || waitOrder.status !== "PENDING") return;
    const restored = waitOrder.items.map(item => ({ menuId: item.menuId, qty: item.quantity, options: item.options }));
    setCart(restored);
    setEditingWaitOrder({ id: waitOrder.waitOrderId, version: waitOrder.version });
    setWaitError("");
    openCartSheet();
  };

  const cancelWaitOrder = async () => {
    if (!waitOrder || waitBusy || !["PENDING", "ASSIGNED"].includes(waitOrder.status)) return;
    setWaitBusy(true);
    setWaitError("");
    try {
      const response = await fetch(`/api/qr/wait-orders/${waitOrder.waitOrderId}`, { method: "DELETE", credentials: "same-origin" });
      const payload = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "대기 주문을 취소하지 못했습니다.");
      setWaitOrder({ ...waitOrder, status: "CANCELLED" });
      try { localStorage.removeItem(QR_WAIT_ORDER_ID_KEY); } catch { /* current page state is sufficient */ }
    } catch (error) { setWaitError(error instanceof Error ? error.message : "대기 주문을 취소하지 못했습니다."); }
    finally { setWaitBusy(false); }
  };

  return <main className="min-h-svh bg-white pb-28 text-slate-900" style={titleData.photos.length ? { paddingTop: "calc(75vw - clamp(32px, 8vw, 40px))" } : undefined}>
    {titleData.photos.length > 0 && <QrTitleCarousel fixedHero photos={titleData.photos} />}
    <div className="relative z-10" data-qr-content>
    {titleData.photos.length > 0 && <span aria-hidden="true" className="absolute left-0 top-0 h-px w-px" data-qr-content-start />}
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-0 bg-white top-[var(--qr-menu-backdrop-top,0px)]" data-qr-menu-backdrop />
    <QrStoreTitle fixedHero={titleData.photos.length > 0} notices={notices} settings={titleData} />
    <header data-qr-header className="sticky top-0 z-20 border-b border-slate-200 bg-transparent px-3 py-2 data-[qr-stuck=true]:bg-white">
      <nav aria-label="메뉴 분류" className="mx-auto flex max-w-2xl gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" ref={categoryTabNavRef}>
        {catalog?.categories.map(category => { const active = selectedCategoryId === category.categoryId; return <button aria-current={active ? "location" : undefined} aria-pressed={active} className={`min-h-10 shrink-0 rounded-lg px-3 text-center text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800 ${active ? "bg-[#777777] text-white" : "bg-transparent text-[#777777]"}`} key={category.categoryId} onClick={() => selectCategory(category.categoryId)} ref={element => {
          if (element) categoryTabRefs.current.set(category.categoryId, element); else categoryTabRefs.current.delete(category.categoryId);
        }} type="button">{category.name}</button>; })}
      </nav>
    </header>

    <div className="relative z-[1] bg-white">
    {waitingMode && waitOrder && <section className="mx-auto mt-3 max-w-2xl px-3" aria-label="대기 주문 상태">
      <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-500">대기 주문번호</p><h2 className="mt-1 text-xl font-extrabold">{waitOrder.publicReference}</h2><p className="mt-1 text-sm font-semibold text-blue-700">{waitOrder.status === "PENDING" ? "직원 확인 대기" : waitOrder.status === "ASSIGNED" ? "테이블 배정 · 직원 확인 대기" : waitOrder.status === "CONFIRMED" ? "직원 주문 확정" : waitOrder.status === "CANCELLED" ? "취소됨" : "만료됨"} · 예상 {won(Number(waitOrder.estimatedTotal), locale)}</p></div>
          <button className="min-h-10 rounded-lg bg-slate-100 px-3 text-sm font-bold" disabled={waitBusy} onClick={() => void loadWaitOrder(waitOrder.waitOrderId).catch(() => setWaitError("대기 주문을 새로고침하지 못했습니다."))} type="button">새로고침</button></div>
        <ul className="mt-3 space-y-1 text-sm text-slate-600">{waitOrder.items.map((item, index) => <li key={`${item.menuId}-${index}`}>{item.itemName} × {item.quantity}</li>)}</ul>
        <div className="mt-3 flex gap-2">{waitOrder.status === "PENDING" && <button className="min-h-11 flex-1 rounded-xl bg-blue-600 font-bold text-white" onClick={editWaitOrder} type="button">주문 수정</button>}{["PENDING", "ASSIGNED"].includes(waitOrder.status) && <button className="min-h-11 flex-1 rounded-xl border border-red-200 bg-red-50 font-bold text-red-700" disabled={waitBusy} onClick={() => void cancelWaitOrder()} type="button">대기 주문 취소</button>}</div>
        {waitError && <p className="mt-2 text-sm font-semibold text-red-600" role="alert">{waitError}</p>}
      </div>
    </section>}

    {loading ? <div aria-live="polite" className="mx-auto max-w-2xl px-4 py-16 text-center text-slate-500">{t.loading}</div>
      : catalogError ? <div className="mx-auto max-w-2xl px-4 py-16 text-center"><p className="mb-1 text-slate-600" role="alert">{catalogError.kind === "http" ? `${t.error} (HTTP ${catalogError.status})` : catalogError.kind === "network" ? t.networkError : t.invalidError}</p><button className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white" onClick={() => void loadCatalog()} type="button">{t.retry}</button></div>
        : <div aria-label={currentCategory?.name ?? "메뉴"} className="mx-auto min-h-[calc(100dvh-10rem)] max-w-2xl px-3 py-2" data-qr-menu-page>
          {currentCategoryMenus.length === 0 ? <p className="px-2 py-8 text-center text-sm text-slate-500">{t.noMenus}</p> : <div className="divide-y divide-slate-200 rounded-2xl bg-white px-3">{currentCategoryMenus.map(menu => <button className="flex min-h-32 w-full items-stretch gap-3 py-4 text-left active:bg-slate-50" key={menu.menuId} onClick={() => openMenu(menu)} type="button"><span className="flex min-w-0 flex-1 flex-col items-start"><strong className="line-clamp-2 text-[18px] font-extrabold leading-snug">{menu.name}</strong><span className="mt-auto pt-2 text-[18px] font-bold tabular-nums">{won(Number(menu.price), locale)}</span></span>{menu.imageUrl ? <Image alt={menu.name} className="h-28 w-28 shrink-0 rounded-xl bg-slate-100 object-cover" height={112} loading="lazy" src={menu.imageUrl} unoptimized width={112} /> : <span aria-label={t.noImage} className="flex h-28 w-28 shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-br from-amber-50 to-slate-100 text-3xl" role="img"><span aria-hidden="true">{"\uD83C\uDF72"}</span><span className="text-[10px] font-medium text-slate-500">{t.noImage}</span></span>}</button>)}</div>}
        </div>}
    </div>

    {cartSheetOpen && <button aria-label={t.close} className="fixed inset-0 z-30 bg-slate-950/45 transition-opacity duration-300 ease-out motion-reduce:transition-none" onClick={() => closeCartSheet()} type="button" />}
    <section aria-label={t.cart} aria-modal={cartSheetOpen ? "true" : undefined} className={`fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[82dvh] max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-blue-700 pb-[max(1rem,env(safe-area-inset-bottom))] text-white shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${cartSheetOpen ? "translate-y-0" : "translate-y-[calc(100%-72px)]"}`} data-qr-cart-sheet role={cartSheetOpen ? "dialog" : "region"}>
      <button aria-expanded={cartSheetOpen} aria-label={cartSheetOpen ? t.cart + " " + t.close : t.cart} className="flex min-h-[72px] shrink-0 flex-col items-center px-4 pb-3 pt-2 text-left" onClick={toggleCartSheet} onTouchStart={handleCartHeaderTouchStart} onTouchEnd={handleCartHeaderTouchEnd} type="button">
        <span aria-hidden="true" className="mb-2 h-1 w-10 rounded-full bg-white/90" />
        <span className="flex w-full max-w-xl items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 font-extrabold"><svg aria-hidden="true" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 3h2l2.2 11.2a2 2 0 0 0 2 1.6h8.9a2 2 0 0 0 1.9-1.4L22 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg><span>{t.cart}</span><span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{itemCount}{t.count}</span></span>
          <span className="flex shrink-0 items-center gap-2 font-bold tabular-nums">{won(total, locale)}<svg aria-hidden="true" className={`h-5 w-5 transition-transform duration-300 motion-reduce:transition-none ${cartSheetOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></span>
        </span>
      </button>
      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 text-slate-900" inert={!cartSheetOpen}>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {cart.length === 0 ? <p className="py-10 text-center text-slate-500">{t.empty}</p> : <div className="divide-y divide-slate-100">{cart.map((line, index) => {
            const menu = catalog?.menus.find(item => item.menuId === line.menuId);
            if (!menu) return null;
            const optionNames = line.options.map(selected => menu.groups.flatMap(group => group.options).find(option => option.modifierOptionId === selected.modifierOptionId)?.optionName).filter(Boolean);
            return <div className="py-3" key={line.menuId + "-" + line.options.map(option => option.modifierOptionId).join("-") + "-" + index}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate">{menu.name}</strong>{optionNames.length > 0 && <p className="mt-1 text-xs text-slate-500">{optionNames.join("\u00b7")}</p>}<p className="mt-1 text-sm font-bold tabular-nums">{won(qrLineUnitPrice(menu, line.options) * line.qty, locale)}</p></div><div className="flex shrink-0 items-center gap-2"><button aria-label={menu.name + " " + t.qty + " -"} className="h-9 w-9 rounded-full bg-slate-100 font-bold" onClick={() => changeCartQty(line, -1)} type="button">-</button><span className="min-w-5 text-center tabular-nums">{line.qty}</span><button aria-label={menu.name + " " + t.qty + " +"} className="h-9 w-9 rounded-full bg-slate-100 font-bold" onClick={() => changeCartQty(line, 1)} type="button">+</button><button aria-label={menu.name + " " + t.remove} className="ml-1 px-2 py-2 text-xs font-semibold text-red-600" onClick={() => removeCartLine(line)} type="button">{t.remove}</button></div></div></div>;
          })}</div>}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 pb-2 pt-3"><div className="mx-auto max-w-xl"><div className="flex items-center justify-between text-lg font-extrabold"><span>{t.total}</span><span className="tabular-nums">{won(total, locale)}</span></div><p className="mt-2 text-xs leading-relaxed text-slate-500">{t.estimate}</p>
          {waitingMode && <>{waitError && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{waitError}</p>}<button className="mt-3 min-h-12 w-full rounded-xl bg-blue-600 font-extrabold text-white disabled:opacity-50" disabled={!cart.length || waitBusy || Boolean(waitOrder && ["PENDING", "ASSIGNED"].includes(waitOrder.status) && !editingWaitOrder)} onClick={() => void submitWaitOrder()} type="button">{waitBusy ? "\uCC98\uB9AC \uC911..." : editingWaitOrder ? "\uB300\uAE30 \uC8FC\uBB38 \uC218\uC815 \uC800\uC7A5" : "\uB300\uAE30 \uC8FC\uBB38 \uB4F1\uB85D"}</button></>}
          {!waitingMode && <a className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-amber-50 text-sm font-bold text-amber-900" href="/qr/wait">{"\uB300\uAE30 QR\uC5D0\uC11C \uB300\uAE30 \uC8FC\uBB38 \uB4F1\uB85D"}</a>}
        </div></div>
      </div>
    </section>

    {view && currentMenu && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-2 sm:items-center" onClick={closeView}>
      <section aria-label={currentMenu.name ?? t.title} aria-modal="true" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl" onClick={event => event.stopPropagation()} role="dialog">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 className="min-w-0 truncate text-lg font-extrabold">{currentMenu.name}</h2><button aria-label={t.close} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-xl" onClick={closeView} type="button">?</button></div>
        {view.type === "menu" && currentMenu && <>
          <div className="flex items-center justify-between border-b border-slate-100 pb-3"><span className="font-bold text-slate-600">{t.qty}</span><div className="flex items-center gap-4"><button aria-label="−" className="h-10 w-10 rounded-full bg-slate-100 text-xl font-bold" onClick={() => setQuantity(value => Math.max(1, value - 1))} type="button">−</button><span className="min-w-5 text-center text-lg font-bold tabular-nums">{quantity}</span><button aria-label="+" className="h-10 w-10 rounded-full bg-slate-100 text-xl font-bold" onClick={() => setQuantity(value => Math.min(99, value + 1))} type="button">+</button></div></div>
          {currentMenu.groups.map(group => <fieldset className="border-b border-slate-100 py-4" key={group.modifierGroupId}><legend className="mb-2 flex w-full items-center justify-between gap-2 font-extrabold">{group.name}<span className="text-xs font-semibold text-slate-500">{group.isRequired || group.minSelect > 0 ? t.required : t.optional}{group.maxSelect > 1 ? ` · ${group.minSelect}–${group.maxSelect}` : ""}</span></legend><div className="space-y-1">{group.maxSelect <= 1 && !group.isRequired && group.minSelect === 0 && <label className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-50 px-3"><input checked={(selections[group.modifierGroupId] ?? []).length === 0} className="h-5 w-5 accent-blue-600" name={`group-${group.modifierGroupId}`} onChange={() => setSelections(current => ({ ...current, [group.modifierGroupId]: [] }))} type="radio" /><span className="font-semibold">{t.none}</span></label>}{group.options.map(option => {
            const selected = (selections[group.modifierGroupId] ?? []).includes(option.modifierOptionId);
            return <label className={`flex min-h-12 items-center gap-3 rounded-xl px-3 ${selected ? "bg-blue-50 text-blue-800" : "bg-slate-50"}`} key={option.modifierOptionId}><input checked={selected} className="h-5 w-5 accent-blue-600" name={`group-${group.modifierGroupId}`} onChange={() => toggleOption(group.modifierGroupId, option.modifierOptionId, group.maxSelect > 1, group.maxSelect)} type={group.maxSelect > 1 ? "checkbox" : "radio"} /><span className="min-w-0 flex-1 font-semibold">{option.optionName}</span>{Number(option.priceDelta) !== 0 && <span className="shrink-0 text-sm tabular-nums text-slate-600">{Number(option.priceDelta) > 0 ? "+" : "−"}{won(Math.abs(Number(option.priceDelta)))}</span>}</label>;
          })}</div></fieldset>)}
          {selectionError && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{selectionError}</p>}
          <button className="mt-4 flex min-h-14 w-full items-center justify-between rounded-xl bg-blue-600 px-4 font-extrabold text-white" onClick={addCurrentMenu} type="button"><span>{t.add}</span><span>{won(qrLineUnitPrice(currentMenu, selectedQrOptions(currentMenu.groups, selections)) * quantity, locale)}</span></button>
        </>}
      </section>
    </div>}

    </div>
  </main>;
}
