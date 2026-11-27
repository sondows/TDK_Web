"use client";
import { readJsonResponse } from "@/lib/api-response";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { getMenuChoice } from "@/lib/menu-choice-selection";
import { qrOriginHasDisplayText, qrOriginTextRuns } from "@/lib/qr-menu-description-model";
import { hasQrOrderHistory } from "@/lib/qr-order-history-model";
import { addQrCartLine, defaultQrSelections, formatQrCartPrice, groupQrModifiers, normalizeQrCart, qrCartItemCount, qrCartTotal, qrImmediateAddLine, qrMenuAddonGroups, qrOtherOptionalGroups,
  QR_CART_STORAGE_KEY, qrLineItemCount, qrLineTotal,
  selectedQrOptions, splitQrCartAddonLines, validQrSelections, isQrSpiceGroupName, type QrCartLine, type QrCatalog, type QrLocale, type QrMenu } from "@/lib/qr-menu-cart";
import { acknowledgeQrCartEvents, appendQrCartEvents, normalizeQrCartEventOutbox, QR_CART_EVENT_BATCH_SIZE, QR_CART_EVENT_OUTBOX_KEY,
  qrCartEventSourceFromSearch, type QrCartAnalyticsEvent, type QrCartEventSource, type QrCartEventType } from "@/lib/qr-cart-analytics";
import QrStoreTitle from "./QrStoreTitle";
import QrTitleCarousel from "./QrTitleCarousel";
import { useQrCustomerLanguage } from "./QrCustomerLanguageProvider";
import QrDoubleDivider from "./QrDoubleDivider";
import QrMenuAddIcon from "@/components/QrMenuAddIcon";
import { qrTitleHeroOverlap, qrTitleInitialCardTop, qrTitleInitialScroll, type QrPublicTitleSettings } from "@/lib/qr-title-model";
import type { QrPublicNotice } from "@/lib/qr-notice-model";

const copy: Record<QrLocale, Record<string, string>> = {
  ko: { title: "메뉴", cart: "장바구니", count: "개", empty: "장바구니가 비어 있습니다.", add: "장바구니에 담기", close: "닫기", qty: "수량", total: "주문금액", remove: "삭제", required: "필수", optional: "선택", none: "선택 안 함", loading: "메뉴를 불러오는 중입니다.", error: "메뉴를 불러오지 못했습니다.", networkError: "네트워크 연결을 확인해 주세요.", invalidError: "메뉴 서버 응답을 확인할 수 없습니다.", retry: "다시 시도", noMenus: "이 분류에 표시할 메뉴가 없습니다.", noImage: "메뉴 사진", optionPrice: "추가", language: "언어" },
  en: { title: "Menu", cart: "Cart", count: "items", empty: "Your cart is empty.", add: "Add to cart", close: "Close", qty: "Qty", total: "Order amount", remove: "Remove", required: "Required", optional: "Optional", none: "No selection", loading: "Loading menu…", error: "Could not load the menu.", networkError: "Check your network connection.", invalidError: "The menu server returned an invalid response.", retry: "Try again", noMenus: "No items in this category.", noImage: "Menu photo", optionPrice: "Add", language: "Language" },
  "zh-CN": { title: "菜单", cart: "购物车", count: "份", empty: "购物车为空。", add: "加入购物车", close: "关闭", qty: "数量", total: "订单金额", remove: "删除", required: "必选", optional: "可选", none: "不选择", loading: "正在加载菜单…", error: "无法加载菜单。", networkError: "请检查网络连接。", invalidError: "菜单服务器返回了无效数据。", retry: "重试", noMenus: "此分类暂无菜单。", noImage: "菜品图片", optionPrice: "加价", language: "语言" },
  ja: { title: "メニュー", cart: "カート", count: "点", empty: "カートは空です。", add: "カートに入れる", close: "閉じる", qty: "数量", total: "注文金額", remove: "削除", required: "必須", optional: "任意", none: "選択しない", loading: "メニューを読み込み中…", error: "メニューを読み込めませんでした。", networkError: "ネットワーク接続を確認してください。", invalidError: "メニューサーバーの応答を確認できません。", retry: "再試行", noMenus: "このカテゴリにメニューはありません。", noImage: "料理写真", optionPrice: "追加", language: "言語" },
};
const QR_WAIT_ORDER_ID_KEY = "tdkon:qr-wait-order-id:v1";
const qrAuthClockNow = () => Date.now();
type QrAuthAttemptUi = { attemptId: string; requestId: string; state: string; requestExpiresAtMs: number; codeExpiresAtMs: number | null; serverNowMs: number; expiresAtLocalMs: number; verified: boolean };
type StoredQrAuthAttempt = { requestId: string; cartSnapshot: string; attemptId?: string; requestExpiresAtMs?: number; codeExpiresAtMs?: number | null; serverNowMs?: number; verified?: boolean };
type WaitOrder = { waitOrderId: number; publicReference: string; status: string; version: number; estimatedTotal: string; items: Array<{ menuId: number; itemName: string; quantity: number; options: QrCartLine["options"] }> };
type ApiCatalog = { categories: Array<{ categoryId: number; name: string; tabColor: string | null }>; menus: Array<Omit<QrMenu, "groups">>; modifierGroups: Array<{ menuId: number; modifierGroupId: number; name: string; minSelect: number; maxSelect: number; isRequired: boolean; defaultOptionId: number | null; modifierOptionId: number; optionName: string; qrDescription?: string; priceDelta: string; groupSortOrder: number; optionSortOrder: number; source: "MENU_ADDON" | "OPTION" }> };
type CatalogError = { kind: "http"; status: number } | { kind: "network" | "invalid" } | null;

function won(value: number, locale: QrLocale = "ko") {
  const numberLocale = locale === "zh-CN" ? "zh-CN" : locale;
  return new Intl.NumberFormat(numberLocale, { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(Math.round(value));
}

function menuCardPrice(value: number, locale: QrLocale) {
  if (locale === "ko") return `${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.round(value))}원`;
  return won(value, locale);
}

function qrOptionLabel(option: { optionName: string; qrDescription?: string }, locale: QrLocale) {
  const description = locale === "ko" ? option.qrDescription?.trim() : "";
  return description ? `${option.optionName} (${description})` : option.optionName;
}

function hosDefaultSelections(groups: QrMenu["groups"]) {
  const selections = defaultQrSelections(groups);
  for (const group of groups) {
    if (group.defaultOptionId === null && !isQrSpiceGroupName(group.name)) continue;
    const choice = getMenuChoice(group.options.map(option => ({ modifierGroupId: group.modifierGroupId,
      groupName: group.name, modifierOptionId: option.modifierOptionId, optionName: option.optionName,
      optionSortOrder: option.optionSortOrder, choiceDefaultOptionId: group.defaultOptionId })));
    selections[group.modifierGroupId] = choice.selected ? [choice.selected.modifierOptionId] : [];
  }
  return selections;
}

export default function QrMenuClient({ waitingMode = false, tableOrderMode = false, qrAuthFlowEnabled = false, cartTableId = null, initialTitleData, notices = [] }: { waitingMode?: boolean; tableOrderMode?: boolean; qrAuthFlowEnabled?: boolean; cartTableId?: number | null; initialTitleData: QrPublicTitleSettings; notices?: QrPublicNotice[] }) {
  const router = useRouter();
  const { locale } = useQrCustomerLanguage();
  const cartStorageKey = tableOrderMode ? cartTableId === null ? null : `${QR_CART_STORAGE_KEY}:table:${cartTableId}` : QR_CART_STORAGE_KEY;
  const qrAuthStorageKey = cartTableId === null ? null : `tdkon:qr-order-auth:v1:table:${cartTableId}`;
  const [catalog, setCatalog] = useState<QrCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<CatalogError>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [cart, setCart] = useState<QrCartLine[]>([]);
  const [cartReady, setCartReady] = useState(false);
  const [quickAddFeedback, setQuickAddFeedback] = useState("");
  const quickAddFeedbackTimerRef = useRef<number | null>(null);
  const [view, setView] = useState<{ type: "menu"; menuId: number } | null>(null);
  const viewRef = useRef<{ type: "menu"; menuId: number } | null>(null);
  const viewHistoryRef = useRef(false);
  const viewBackPendingRef = useRef(false);
  const queuedMenuRef = useRef<QrMenu | null>(null);
  const viewCloseTimerRef = useRef<number | null>(null);
  const viewClosingRef = useRef(false);
  const [viewOffsetX, setViewOffsetX] = useState(100);
  const [viewDragActive, setViewDragActive] = useState(false);
  const [detailImageIndex, setDetailImageIndex] = useState(0);
  const [detailGalleryOpen, setDetailGalleryOpen] = useState(false);
  const detailGalleryOpenRef = useRef(false);
  const detailGalleryHistoryRef = useRef(false);
  const [galleryScale, setGalleryScale] = useState(1);
  const [galleryOffset, setGalleryOffset] = useState({ x: 0, y: 0 });
  const galleryPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const galleryGestureRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; distance: number; scale: number; pointerType: string; mode: "pan" | "swipe" | "pinch" } | null>(null);
  const galleryLastTapRef = useRef(0);
  const suppressDetailImageClickRef = useRef(false);
  const galleryViewportRef = useRef<HTMLDivElement>(null);
  const galleryImageRef = useRef<HTMLImageElement>(null);
  const [originSheetOpen, setOriginSheetOpen] = useState(false);
  const [originSheetVisible, setOriginSheetVisible] = useState(false);
  const originSheetOpenRef = useRef(false);
  const originHistoryRef = useRef(false);
  const originSheetCloseTimerRef = useRef<number | null>(null);
  const originSheetFrameRef = useRef<number | null>(null);
  const [spiceSheetOpen, setSpiceSheetOpen] = useState(false);
  const [spiceSheetVisible, setSpiceSheetVisible] = useState(false);
  const spiceSheetOpenRef = useRef(false);
  const spiceHistoryRef = useRef(false);
  const spiceSheetCloseTimerRef = useRef<number | null>(null);
  const spiceSheetFrameRef = useRef<number | null>(null);
  const detailGestureRef = useRef<{ x: number; y: number; startedAt: number; width: number; carousel: boolean; edge: boolean; cancelled: boolean } | null>(null);
  const originDragStartRef = useRef<number | null>(null);
  const addSubmittedRef = useRef(false);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [clearCartDialogOpen, setClearCartDialogOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [frontQrExited, setFrontQrExited] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const [exitError, setExitError] = useState("");
  const [historyNoticeMessage, setHistoryNoticeMessage] = useState("");
  const [tableQrOpen, setTableQrOpen] = useState(false);
  const [tableQrBusy, setTableQrBusy] = useState(false);
  const [tableQrError, setTableQrError] = useState("");
  const [tableQrUrl, setTableQrUrl] = useState("");
  const [tableQrImage, setTableQrImage] = useState("");
  const [tableQrNo, setTableQrNo] = useState<string | number | null>(null);
  const [tableQrNotice, setTableQrNotice] = useState("");
  const [selections, setSelections] = useState<Record<number, number[]>>({});
  const [addonQuantities, setAddonQuantities] = useState<Record<number, number>>({});
  const [quantity, setQuantity] = useState(1);
  const [selectionError, setSelectionError] = useState("");
  const [qrSource] = useState<QrCartEventSource>(() => waitingMode ? "WAITING" :
    typeof window === "undefined" ? "FRONT" : qrCartEventSourceFromSearch(window.location.search));
  const [waitOrder, setWaitOrder] = useState<WaitOrder | null>(null);
  const [waitBusy, setWaitBusy] = useState(false);
  const [tableOrderBusy, setTableOrderBusy] = useState(false);
  const [qrAuthDialogOpen, setQrAuthDialogOpen] = useState(false);
  const [qrAuthAttempt, setQrAuthAttempt] = useState<QrAuthAttemptUi | null>(null);
  const [qrAuthCode, setQrAuthCode] = useState("");
  const [qrAuthBusy, setQrAuthBusy] = useState(false);
  const [qrAuthMessage, setQrAuthMessage] = useState("");
  const [qrAuthRequiresRestart, setQrAuthRequiresRestart] = useState(false);
  const [qrAuthAttemptsRemaining, setQrAuthAttemptsRemaining] = useState(3);
  const [qrAuthNow, setQrAuthNow] = useState(0);
  const [representativeState, setRepresentativeState] = useState(qrAuthFlowEnabled ? "UNKNOWN" : "");
  const [waitError, setWaitError] = useState("");
  const [editingWaitOrder, setEditingWaitOrder] = useState<{ id: number; version: number } | null>(null);
  const [titleData] = useState(initialTitleData);
  const qrVisitorReady = useRef(false);
  const catalogSnapshotRef = useRef<QrCatalog | null>(null);
  const catalogRefreshInFlightRef = useRef(false);
  const categoryTabNavRef = useRef<HTMLElement>(null);
  const categoryTabRefs = useRef(new Map<number, HTMLButtonElement>());
  const menuRowRefs = useRef(new Map<number, HTMLElement>());
  const menuBottomSpacerRef = useRef<HTMLDivElement>(null);
  const categoryScrollProgrammaticRef = useRef(false);
  const categoryScrollSettleTimerRef = useRef<number | null>(null);
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
      if (event.key === "Escape" && !clearCartDialogOpen) closeCartSheet();
    };
    const onPopState = (event: PopStateEvent) => {
      // A nested QR notice sheet may pop back to this still-open cart entry.
      if (event.state?.tdkQrCartSheet) return;
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
  }, [cartSheetOpen, clearCartDialogOpen, closeCartSheet]);

  useEffect(() => {
    if (!clearCartDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setClearCartDialogOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearCartDialogOpen]);

  useEffect(() => {
    if (!view) return;
    const frame = window.requestAnimationFrame(() => setViewOffsetX(0));
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  useEffect(() => () => {
    if (viewCloseTimerRef.current !== null) window.clearTimeout(viewCloseTimerRef.current);
    if (originSheetCloseTimerRef.current !== null) window.clearTimeout(originSheetCloseTimerRef.current);
    if (originSheetFrameRef.current !== null) window.cancelAnimationFrame(originSheetFrameRef.current);
  }, []);

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
      const result = await readJsonResponse(response, response.url, "API request") as { success?: boolean; acceptedEventIds?: unknown };
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
      const data = await readJsonResponse(response, response.url, "API request").catch(() => null) as (ApiCatalog & { success?: boolean }) | null;
      if (!data?.success || !Array.isArray(data.menus) || !Array.isArray(data.categories)) {
        if (!silent) setCatalogError({ kind: "invalid" });
        return;
      }
      const menus: QrMenu[] = data.menus.map(menu => ({ ...menu,
        groups: groupQrModifiers(data.modifierGroups ?? [], menu.menuId) }));
      const next = { categories: data.categories, menus };
      const firstAvailableCategoryId = next.categories.find(category => next.menus.some(menu => menu.categoryId === category.categoryId))?.categoryId ?? null;
      catalogSnapshotRef.current = next;
      setCatalog(next);
      setCatalogError(null);
      setSelectedCategoryId(current => current !== null && next.menus.some(menu => menu.categoryId === current)
        ? current : firstAvailableCategoryId);
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
  useEffect(() => () => {
    if (quickAddFeedbackTimerRef.current !== null) window.clearTimeout(quickAddFeedbackTimerRef.current);
  }, []);
  useEffect(() => {
    if (!catalog) return;
    const timer = window.setTimeout(() => {
      try {
        const raw = cartStorageKey === null ? null : localStorage.getItem(cartStorageKey);
        setCart(splitQrCartAddonLines(normalizeQrCart(raw ? JSON.parse(raw) : [], catalog), catalog));
      } catch { setCart([]); }
      setCartReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [catalog, cartStorageKey]);
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
    if (!cartReady || cartStorageKey === null) return;
    try { localStorage.setItem(cartStorageKey, JSON.stringify(cart)); } catch { /* menu remains usable without persistence */ }
  }, [cart, cartReady, cartStorageKey]);

  const currentMenu = view?.type === "menu" ? catalog?.menus.find(menu => menu.menuId === view.menuId) ?? null : null;
  const currentDetailImages = currentMenu?.detailImages?.length ? currentMenu.detailImages : currentMenu?.imageUrl ? [currentMenu.imageUrl] : [];
  const originTextRuns = currentMenu?.originDescription ? qrOriginTextRuns(currentMenu.originDescription) : [];
  const hasOriginDescription = qrOriginHasDisplayText(currentMenu?.originDescription);
  const spiceGroup = currentMenu?.groups.find(group => isQrSpiceGroupName(group.name)) ?? null;
  const selectedSpiceOption = spiceGroup
    ? spiceGroup.options.find(option => (selections[spiceGroup.modifierGroupId] ?? []).includes(option.modifierOptionId)) ?? null
    : null;
  const otherRequiredGroups = currentMenu?.groups.filter(group => group !== spiceGroup && (group.isRequired || group.minSelect > 0)) ?? [];
  const menuAddonGroups = currentMenu ? qrMenuAddonGroups(currentMenu.groups) : [];
  const addonOptionById = new Map(menuAddonGroups.flatMap(group => group.options.map(option => [option.modifierOptionId, option] as const)));
  const addonDisplayEntries = currentMenu?.addonDisplayEntries ?? menuAddonGroups.flatMap(group => group.options.map(option => ({
    type: "menu" as const, entryId: option.modifierOptionId, menuId: currentMenu?.menuId ?? 0,
    name: option.optionName, price: option.priceDelta, isQrVisible: true,
  })));
  const otherOptionalGroups = currentMenu ? qrOtherOptionalGroups(currentMenu.groups) : [];
  const keepSpiceBottomBorder = addonDisplayEntries.length === 0 || otherRequiredGroups.length > 0 || otherOptionalGroups.length > 0;
  const categoryMenuGroups = useMemo(() => (catalog?.categories ?? []).flatMap(category => {
    const menus = catalog?.menus.filter(menu => menu.categoryId === category.categoryId) ?? [];
    return menus.length ? [{ category, menus }] : [];
  }), [catalog]);
  const itemCount = qrCartItemCount(cart);
  const cartHasItems = itemCount > 0;
  const cartHeaderVisible = cartSheetOpen || cartHasItems;
  const cartPeekHeight = cartHasItems ? 57.6 : 17.28;
  const total = catalog ? qrCartTotal(cart, catalog.menus) : 0;
  const openDetailGallery = () => {
    if (detailGalleryOpenRef.current || !currentDetailImages.length) return;
    detailGalleryOpenRef.current = true;
    setGalleryScale(1);
    setGalleryOffset({ x: 0, y: 0 });
    setDetailGalleryOpen(true);
    window.history.pushState({ ...(window.history.state ?? {}), tdkQrDetailGallery: true }, "", window.location.href);
    detailGalleryHistoryRef.current = true;
  };
  const closeDetailGallery = (fromHistory = false) => {
    if (!detailGalleryOpenRef.current) return;
    detailGalleryOpenRef.current = false;
    setDetailGalleryOpen(false);
    galleryPointersRef.current.clear();
    galleryGestureRef.current = null;
    if (detailGalleryHistoryRef.current) {
      detailGalleryHistoryRef.current = false;
      if (!fromHistory) window.history.back();
    }
  };
  const changeGalleryImage = (direction: number) => {
    setDetailImageIndex(index => Math.max(0, Math.min(currentDetailImages.length - 1, index + direction)));
    setGalleryScale(1);
    setGalleryOffset({ x: 0, y: 0 });
  };
  const toggleGalleryZoom = () => {
    setGalleryScale(current => current > 1 ? 1 : 2);
    setGalleryOffset({ x: 0, y: 0 });
  };
  const galleryOffsetLimits = (scale: number) => {
    const viewport = galleryViewportRef.current;
    const image = galleryImageRef.current;
    const width = viewport?.clientWidth ?? window.innerWidth;
    const height = viewport?.clientHeight ?? window.innerHeight;
    return {
      x: Math.max(0, ((image?.clientWidth ?? width) * scale - width) / 2),
      y: Math.max(0, ((image?.clientHeight ?? height) * scale - height) / 2),
    };
  };
  const galleryActionsRef = useRef({ closeDetailGallery, changeGalleryImage, toggleGalleryZoom });
  useLayoutEffect(() => {
    galleryActionsRef.current = { closeDetailGallery, changeGalleryImage, toggleGalleryZoom };
  });
  const openMenu = (menu: QrMenu) => {
    if (viewBackPendingRef.current) {
      queuedMenuRef.current = menu;
      return;
    }
    if (viewRef.current) return;
    queueCartEvent("MENU_VIEW", menu.menuId, [], 0, 0);
    setSelections(hosDefaultSelections(menu.groups));
    setAddonQuantities({});
    setQuantity(1);
    spiceSheetOpenRef.current = false;
    spiceHistoryRef.current = false;
    setSpiceSheetOpen(false);
    setSpiceSheetVisible(false);
    setSelectionError("");
    setDetailImageIndex(0);
    setViewDragActive(false);
    setOriginSheetOpen(false);
    setOriginSheetVisible(false);
    originSheetOpenRef.current = false;
    originHistoryRef.current = false;
    if (originSheetCloseTimerRef.current !== null) window.clearTimeout(originSheetCloseTimerRef.current);
    if (originSheetFrameRef.current !== null) window.cancelAnimationFrame(originSheetFrameRef.current);
    viewRef.current = { type: "menu", menuId: menu.menuId };
    setViewOffsetX(100);
    setView({ type: "menu", menuId: menu.menuId });
    window.history.pushState({ ...(window.history.state ?? {}), tdkQrMenuDetail: true }, "", window.location.href);
    viewHistoryRef.current = true;
  };
  const quickAddMenu = (menu: QrMenu) => {
    const line = qrImmediateAddLine(menu, hosDefaultSelections(menu.groups));
    if (!line) {
      openMenu(menu);
      return;
    }
    const matchingLine = (candidate: QrCartLine) => candidate.menuId === line.menuId && JSON.stringify(candidate.options) === JSON.stringify(line.options);
    const quantityBefore = cart.find(matchingLine)?.qty ?? 0;
    setCart(current => addQrCartLine(current, line, menu));
    queueCartEvent("ADD", menu.menuId, line.options.map(option => option.modifierOptionId), quantityBefore, Math.min(99, quantityBefore + 1));
    const feedback = locale === "ko" ? `${menu.name} 장바구니에 담았습니다`
      : locale === "en" ? `${menu.name} added to cart`
        : locale === "ja" ? `${menu.name}をカートに追加しました`
          : `${menu.name} 已加入购物车`;
    setQuickAddFeedback(feedback);
    if (quickAddFeedbackTimerRef.current !== null) window.clearTimeout(quickAddFeedbackTimerRef.current);
    quickAddFeedbackTimerRef.current = window.setTimeout(() => {
      quickAddFeedbackTimerRef.current = null;
      setQuickAddFeedback("");
    }, 1600);
  };
  useEffect(() => {
    if (!catalog) return;
    const header = document.querySelector<HTMLElement>("[data-qr-header]");
    if (!header) return;
    let frame = 0;
    const updateSelectedFromTopRow = () => {
      frame = 0;
      if (categoryScrollProgrammaticRef.current) return;
      const rowTop = header.getBoundingClientRect().bottom;
      let topRowMenu = catalog.menus.find(menu => {
        const element = menuRowRefs.current.get(menu.menuId);
        return element && element.getBoundingClientRect().bottom > rowTop + 1;
      });
      if (!topRowMenu) topRowMenu = catalog.menus.at(-1);
      if (topRowMenu?.categoryId !== null && topRowMenu?.categoryId !== undefined) {
        setSelectedCategoryId(current => current === topRowMenu?.categoryId ? current : topRowMenu!.categoryId);
      }
    };
    const requestUpdate = () => {
      if (categoryScrollProgrammaticRef.current) {
        if (categoryScrollSettleTimerRef.current !== null) window.clearTimeout(categoryScrollSettleTimerRef.current);
        categoryScrollSettleTimerRef.current = window.setTimeout(() => {
          categoryScrollProgrammaticRef.current = false;
          categoryScrollSettleTimerRef.current = null;
          updateSelectedFromTopRow();
        }, 140);
        return;
      }
      if (!frame) frame = window.requestAnimationFrame(updateSelectedFromTopRow);
    };
    updateSelectedFromTopRow();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (frame) window.cancelAnimationFrame(frame);
      if (categoryScrollSettleTimerRef.current !== null) window.clearTimeout(categoryScrollSettleTimerRef.current);
      categoryScrollSettleTimerRef.current = null;
      categoryScrollProgrammaticRef.current = false;
    };
  }, [catalog]);
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
  useEffect(() => {
    const lastMenu = categoryMenuGroups.at(-1)?.menus[0];
    if (!lastMenu) return;
    const resizeBottomSpacer = () => {
      const target = menuRowRefs.current.get(lastMenu.menuId);
      const header = document.querySelector<HTMLElement>("[data-qr-header]");
      const spacer = menuBottomSpacerRef.current;
      if (!target || !header || !spacer) return;
      const currentSpacerHeight = spacer.getBoundingClientRect().height;
      const baseDocumentHeight = document.documentElement.scrollHeight - currentSpacerHeight;
      const targetScrollTop = window.scrollY + target.getBoundingClientRect().top - header.offsetHeight;
      const requiredSpacerHeight = Math.max(0, targetScrollTop - (baseDocumentHeight - window.innerHeight));
      spacer.style.height = `${requiredSpacerHeight}px`;
    };
    resizeBottomSpacer();
    window.addEventListener("resize", resizeBottomSpacer);
    window.addEventListener("orientationchange", resizeBottomSpacer);
    return () => {
      window.removeEventListener("resize", resizeBottomSpacer);
      window.removeEventListener("orientationchange", resizeBottomSpacer);
    };
  }, [categoryMenuGroups]);
  const selectCategory = (categoryId: number) => {
    const firstMenu = catalog?.menus.find(menu => menu.categoryId === categoryId);
    const target = firstMenu ? menuRowRefs.current.get(firstMenu.menuId) : null;
    const header = document.querySelector<HTMLElement>("[data-qr-header]");
    if (!firstMenu || !target || !header) return;
    setSelectedCategoryId(categoryId);
    const spacer = menuBottomSpacerRef.current;
    const currentSpacerHeight = spacer?.getBoundingClientRect().height ?? 0;
    const baseDocumentHeight = document.documentElement.scrollHeight - currentSpacerHeight;
    const targetScrollTop = window.scrollY + target.getBoundingClientRect().top - header.offsetHeight;
    const requiredSpacerHeight = Math.max(0, targetScrollTop - (baseDocumentHeight - window.innerHeight));
    if (spacer) spacer.style.height = `${requiredSpacerHeight}px`;
    if (Math.abs(targetScrollTop - window.scrollY) < 1) return;
    categoryScrollProgrammaticRef.current = true;
    if (categoryScrollSettleTimerRef.current !== null) window.clearTimeout(categoryScrollSettleTimerRef.current);
    categoryScrollSettleTimerRef.current = window.setTimeout(() => {
      categoryScrollProgrammaticRef.current = false;
      categoryScrollSettleTimerRef.current = null;
    }, 1200);
    window.requestAnimationFrame(() => {
      const targetTop = window.scrollY + target.getBoundingClientRect().top - header.offsetHeight;
      window.scrollTo({ top: Math.max(0, targetTop), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  };
  const closeView = (fromHistory = false) => {
    if (fromHistory) viewHistoryRef.current = false;
    if (!viewRef.current || viewClosingRef.current) return;
    viewClosingRef.current = true;
    setViewDragActive(false);
    setViewOffsetX(100);
    if (viewCloseTimerRef.current !== null) window.clearTimeout(viewCloseTimerRef.current);
    viewCloseTimerRef.current = window.setTimeout(() => {
      viewCloseTimerRef.current = null;
      viewRef.current = null;
      viewClosingRef.current = false;
      addSubmittedRef.current = false;
      setView(null);
      setSelectionError("");
      setViewOffsetX(100);
      if (viewHistoryRef.current) {
        viewHistoryRef.current = false;
        viewBackPendingRef.current = true;
        window.history.back();
      }
    }, 250);
  };
  const closeOriginSheet = (fromHistory = false) => {
    if (!originSheetOpenRef.current) return;
    originSheetOpenRef.current = false;
    setOriginSheetVisible(false);
    if (originHistoryRef.current) {
      originHistoryRef.current = false;
      if (!fromHistory) window.history.back();
    }
    if (originSheetCloseTimerRef.current !== null) window.clearTimeout(originSheetCloseTimerRef.current);
    originSheetCloseTimerRef.current = window.setTimeout(() => {
      originSheetCloseTimerRef.current = null;
      setOriginSheetOpen(false);
    }, 250);
  };
  const openOriginSheet = () => {
    if (originSheetOpenRef.current) return;
    if (originSheetCloseTimerRef.current !== null) {
      window.clearTimeout(originSheetCloseTimerRef.current);
      originSheetCloseTimerRef.current = null;
    }
    if (originSheetFrameRef.current !== null) window.cancelAnimationFrame(originSheetFrameRef.current);
    originSheetOpenRef.current = true;
    setOriginSheetOpen(true);
    setOriginSheetVisible(false);
    window.history.pushState({ ...(window.history.state ?? {}), tdkQrMenuOrigin: true }, "", window.location.href);
    originHistoryRef.current = true;
    originSheetFrameRef.current = window.requestAnimationFrame(() => {
      originSheetFrameRef.current = null;
      if (originSheetOpenRef.current) setOriginSheetVisible(true);
    });
  };
  const closeSpiceSheet = (fromHistory = false) => {
    if (!spiceSheetOpenRef.current) return;
    spiceSheetOpenRef.current = false;
    setSpiceSheetVisible(false);
    if (spiceHistoryRef.current) {
      spiceHistoryRef.current = false;
      if (!fromHistory) window.history.back();
    }
    if (spiceSheetCloseTimerRef.current !== null) window.clearTimeout(spiceSheetCloseTimerRef.current);
    spiceSheetCloseTimerRef.current = window.setTimeout(() => {
      spiceSheetCloseTimerRef.current = null;
      setSpiceSheetOpen(false);
    }, 300);
  };
  const openSpiceSheet = () => {
    if (spiceSheetOpenRef.current) return;
    if (spiceSheetCloseTimerRef.current !== null) {
      window.clearTimeout(spiceSheetCloseTimerRef.current);
      spiceSheetCloseTimerRef.current = null;
    }
    spiceSheetOpenRef.current = true;
    setSpiceSheetOpen(true);
    setSpiceSheetVisible(false);
    window.history.pushState({ ...(window.history.state ?? {}), tdkQrMenuSpiceSheet: true }, "", window.location.href);
    spiceHistoryRef.current = true;
    if (spiceSheetFrameRef.current !== null) window.cancelAnimationFrame(spiceSheetFrameRef.current);
    spiceSheetFrameRef.current = window.requestAnimationFrame(() => {
      spiceSheetFrameRef.current = null;
      if (spiceSheetOpenRef.current) setSpiceSheetVisible(true);
    });
  };
  const viewHistoryActionsRef = useRef({ openMenu, closeView, closeOriginSheet, closeSpiceSheet, closeDetailGallery });
  useLayoutEffect(() => {
    viewHistoryActionsRef.current = { openMenu, closeView, closeOriginSheet, closeSpiceSheet, closeDetailGallery };
  });
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (detailGalleryOpenRef.current) {
        if (event.state?.tdkQrDetailGallery) return;
        viewHistoryActionsRef.current.closeDetailGallery(true);
        return;
      }
      if (spiceSheetOpenRef.current) {
        if (event.state?.tdkQrMenuSpiceSheet) return;
        viewHistoryActionsRef.current.closeSpiceSheet(true);
        return;
      }
      if (originSheetOpenRef.current) {
        if (event.state?.tdkQrMenuOrigin) return;
        viewHistoryActionsRef.current.closeOriginSheet(true);
        return;
      }
      if (viewBackPendingRef.current) {
        viewBackPendingRef.current = false;
        const queuedMenu = queuedMenuRef.current;
        queuedMenuRef.current = null;
        if (queuedMenu) viewHistoryActionsRef.current.openMenu(queuedMenu);
        return;
      }
      if (!viewHistoryRef.current || event.state?.tdkQrMenuDetail || event.state?.tdkQrMenuOrigin) return;
      viewHistoryActionsRef.current.closeView(true);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    if (!spiceSheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") viewHistoryActionsRef.current.closeSpiceSheet();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [spiceSheetOpen]);
  useEffect(() => {
    if (!detailGalleryOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") galleryActionsRef.current.closeDetailGallery();
      else if (event.key === "ArrowLeft") galleryActionsRef.current.changeGalleryImage(-1);
      else if (event.key === "ArrowRight") galleryActionsRef.current.changeGalleryImage(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailGalleryOpen]);
  useEffect(() => () => {
    if (spiceSheetCloseTimerRef.current !== null) window.clearTimeout(spiceSheetCloseTimerRef.current);
    if (spiceSheetFrameRef.current !== null) window.cancelAnimationFrame(spiceSheetFrameRef.current);
  }, []);
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
  const getCurrentSelections = () => Object.fromEntries((currentMenu?.groups ?? []).map(group => [group.modifierGroupId,
    group.source === "MENU_ADDON"
      ? group.options.filter(option => (addonQuantities[option.modifierOptionId] ?? 0) > 0).map(option => option.modifierOptionId)
      : selections[group.modifierGroupId] ?? [],
  ]));
  const toggleAddon = (optionId: number) => {
    setSelectionError("");
    setAddonQuantities(current => current[optionId]
      ? Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== optionId))
      : { ...current, [optionId]: 1 });
  };
  const changeAddonQty = (optionId: number, delta: number) => {
    setAddonQuantities(current => {
      const qty = current[optionId] ?? 0;
      if (!qty) return current;
      const next = qty + delta;
      if (next <= 0) return Object.fromEntries(Object.entries(current).filter(([id]) => Number(id) !== optionId));
      if (next > 99) return current;
      return { ...current, [optionId]: next };
    });
  };
  const addCurrentMenu = () => {
    if (addSubmittedRef.current) return;
    const currentSelections = getCurrentSelections();
    if (!currentMenu || !validQrSelections(currentMenu.groups, currentSelections)) {
      setSelectionError("필수 옵션을 선택해 주세요.");
      return;
    }
    const options = selectedQrOptions(currentMenu.groups, currentSelections, addonQuantities);
    const baseOptions = options.filter(option => !addonOptionById.has(option.modifierOptionId));
    const selectedAddons = options.filter(option => addonOptionById.has(option.modifierOptionId)).map(option => {
      const entry = currentMenu.addonDisplayEntries?.find(candidate => candidate.type === "menu" && candidate.entryId === option.modifierOptionId);
      const menu = entry?.type === "menu" ? catalog?.menus.find(candidate => candidate.menuId === entry.menuId) : undefined;
      return menu ? { menu, line: { menuId: menu.menuId, qty: option.qty, options: [] } satisfies QrCartLine } : null;
    });
    if (selectedAddons.some(addon => addon === null)) {
      setSelectionError("추가메뉴 정보를 불러오지 못했습니다. 메뉴를 새로고침해 주세요.");
      return;
    }
    addSubmittedRef.current = true;
    const baseLine: QrCartLine = { menuId: currentMenu.menuId, qty: quantity, options: baseOptions };
    setCart(current => {
      let next = addQrCartLine(current, baseLine, currentMenu);
      for (const addon of selectedAddons) {
        if (addon) next = addQrCartLine(next, addon.line, addon.menu);
      }
      return next;
    });
    const sameOptions = (candidate: QrCartLine) => candidate.menuId === currentMenu.menuId &&
      JSON.stringify(candidate.options) === JSON.stringify(baseOptions);
    const quantityBefore = cart.find(sameOptions)?.qty ?? 0;
    const quantityAfter = Math.min(99, quantityBefore + quantity);
    queueCartEvent("ADD", currentMenu.menuId, baseOptions.map(option => option.modifierOptionId), quantityBefore, quantityAfter);
    for (const addon of selectedAddons) {
      if (!addon) continue;
      const addonBefore = cart.find(line => line.menuId === addon.menu.menuId && line.options.length === 0)?.qty ?? 0;
      queueCartEvent("ADD", addon.menu.menuId, [], addonBefore, Math.min(99, addonBefore + addon.line.qty));
    }
    closeView();
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
  const clearCart = () => {
    for (const line of cart) {
      queueCartEvent("REMOVE", line.menuId, line.options.map(option => option.modifierOptionId), line.qty, 0);
    }
    setCart([]);
    setClearCartDialogOpen(false);
  };

  const loadWaitOrder = useCallback(async (id: number) => {
    const response = await fetch(`/api/qr/wait-orders/${id}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("wait order unavailable");
    const payload = await readJsonResponse(response, response.url, "API request") as { success?: boolean; order?: Omit<WaitOrder, "items">; items?: Array<WaitOrder["items"][number]> };
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
      const payload = await readJsonResponse(response, response.url, "API request") as { success?: boolean; waitOrderId?: number; publicReference?: string; message?: string };
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

  const refreshRepresentativeState = useCallback(async (signal?: AbortSignal) => {
    if (!qrAuthFlowEnabled) return null;
    try {
      const response = await fetch("/api/qr/order-auth", { cache: "no-store", credentials: "same-origin", signal });
      const result = await readJsonResponse(response, response.url, "API request") as { success?: boolean; representativeState?: string };
      if (!response.ok || !result.success || !result.representativeState) throw new Error("대표 주문 상태를 확인하지 못했습니다.");
      if (signal?.aborted) return null;
      setRepresentativeState(result.representativeState);
      return result.representativeState;
    } catch {
      if (!signal?.aborted) setRepresentativeState("UNKNOWN");
      return null;
    }
  }, [qrAuthFlowEnabled]);

  const submitTableOrder = async () => {
    if (!tableOrderMode || tableOrderBusy || !cart.length) return;
    if (qrAuthFlowEnabled) {
      if (!qrAuthStorageKey) { setWaitError("QR 테이블 세션을 확인할 수 없습니다."); return; }
      setTableOrderBusy(true);
      setWaitError("");
      try {
        const currentRepresentativeState = await refreshRepresentativeState();
        if (!currentRepresentativeState) throw new Error("대표 주문 상태를 확인하지 못했습니다.");
        if (currentRepresentativeState === "OWN_CONFIRMED") {
          const followupKey = `${qrAuthStorageKey}:followup`;
          const cartSnapshot = JSON.stringify(cart);
          let saved: StoredQrAuthAttempt | null = null;
          try { saved = JSON.parse(localStorage.getItem(followupKey) ?? "null") as StoredQrAuthAttempt | null; } catch { saved = null; }
          if (!saved || saved.cartSnapshot !== cartSnapshot || !saved.requestId) {
            saved = { requestId: crypto.randomUUID(), cartSnapshot };
            localStorage.setItem(followupKey, JSON.stringify(saved));
          }
          await sendRepresentativeOrder(saved.requestId);
          localStorage.removeItem(followupKey);
          return;
        }
        if (currentRepresentativeState !== "NO_REPRESENTATIVE") {
          throw new Error(currentRepresentativeState === "OWN_PENDING" ? "주문 승인 대기 중입니다."
            : currentRepresentativeState === "OTHER_PENDING" ? "다른 고객의 주문이 승인 대기 중입니다."
              : "현재 이 테이블의 주문은 대표 고객이 진행하고 있습니다.");
        }
        const cartSnapshot = JSON.stringify(cart);
        let stored: StoredQrAuthAttempt | null = null;
        try { stored = JSON.parse(localStorage.getItem(qrAuthStorageKey) ?? "null") as StoredQrAuthAttempt | null; } catch { stored = null; }
        if (!stored || stored.cartSnapshot !== cartSnapshot || !stored.requestId) {
          stored = { requestId: crypto.randomUUID(), cartSnapshot };
          localStorage.setItem(qrAuthStorageKey, JSON.stringify(stored));
        }
        const response = await fetch("/api/qr/order-auth", { method: "POST", headers: { "Content-Type": "application/json" },
          credentials: "same-origin", cache: "no-store", body: JSON.stringify({ requestId: stored.requestId, cart }) });
        const result = await readJsonResponse(response, response.url, "API request") as { success?: boolean; code?: string; message?: string; attemptId?: string; state?: string; requestExpiresAtMs?: number; codeExpiresAtMs?: number | null; serverNowMs?: number };
        if (!response.ok || !result.success || !result.attemptId || !result.requestExpiresAtMs || !result.serverNowMs) {
          if (["ATTEMPT_NOT_REUSABLE", "CODE_EXPIRED"].includes(result.code ?? "")) localStorage.removeItem(qrAuthStorageKey);
          throw new Error(result.message ?? "인증 요청을 시작하지 못했습니다.");
        }
        const nextStored: StoredQrAuthAttempt = { ...stored, attemptId: result.attemptId, requestExpiresAtMs: result.requestExpiresAtMs,
          codeExpiresAtMs: result.codeExpiresAtMs ?? null, serverNowMs: result.serverNowMs, verified: result.state === "VERIFIED" };
        localStorage.setItem(qrAuthStorageKey, JSON.stringify(nextStored));
        setQrAuthAttempt({ attemptId: result.attemptId, requestId: stored.requestId, state: result.state ?? "PENDING",
          requestExpiresAtMs: result.requestExpiresAtMs, codeExpiresAtMs: result.codeExpiresAtMs ?? null,
          serverNowMs: result.serverNowMs, expiresAtLocalMs: qrAuthClockNow() + Math.max(0, Math.min(result.requestExpiresAtMs, result.codeExpiresAtMs ?? result.requestExpiresAtMs) - result.serverNowMs),
          verified: result.state === "VERIFIED" });
        setQrAuthCode("");
        setQrAuthAttemptsRemaining(3);
        setQrAuthMessage("");
        setQrAuthRequiresRestart(false);
        setQrAuthNow(qrAuthClockNow());
        setQrAuthDialogOpen(true);
      } catch (error) {
        setWaitError(error instanceof Error ? error.message : "인증 요청을 시작하지 못했습니다.");
        if (representativeState !== "UNKNOWN") await refreshRepresentativeState();
      }
      finally { setTableOrderBusy(false); }
      return;
    }
    setTableOrderBusy(true);
    setWaitError("");
    try {
      const requestId = crypto.randomUUID();
      const response = await fetch("/api/qr/table-orders", { method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: JSON.stringify({ requestId, cart }) });
      const result = await readJsonResponse(response, response.url, "API request") as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "주문을 전송하지 못했습니다.");
      setCart([]);
      setCartSheetOpen(false);
      router.push("/qrorder");
    } catch (error) { setWaitError(error instanceof Error ? error.message : "주문을 전송하지 못했습니다."); }
    finally { setTableOrderBusy(false); }
  };

  const sendRepresentativeOrder = async (requestId: string, authAttemptId?: string) => {
    const response = await fetch("/api/qr/table-orders", { method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "same-origin", body: JSON.stringify({ requestId, cart, ...(authAttemptId ? { authAttemptId } : {}) }) });
    const result = await readJsonResponse(response, response.url, "API request") as { success?: boolean; message?: string };
    if (!response.ok || !result.success) {
      await refreshRepresentativeState();
      throw new Error(result.message ?? "주문을 접수하지 못했습니다.");
    }
    if (qrAuthStorageKey) { try { localStorage.removeItem(qrAuthStorageKey); } catch { /* Retain current-page state. */ } }
    setCart([]);
    setCartSheetOpen(false);
    setQrAuthDialogOpen(false);
    setRepresentativeState(authAttemptId ? "OWN_PENDING" : "OWN_CONFIRMED");
    router.push("/qrorder");
  };

  const submitVerifiedQrOrder = async () => {
    if (!qrAuthAttempt?.verified || qrAuthBusy) return;
    setQrAuthBusy(true);
    setQrAuthMessage("");
    try { await sendRepresentativeOrder(qrAuthAttempt.requestId, qrAuthAttempt.attemptId); }
    catch (error) { await refreshRepresentativeState(); setQrAuthMessage(error instanceof Error ? error.message : "주문을 접수하지 못했습니다."); }
    finally { setQrAuthBusy(false); }
  };

  const verifyQrOrderAuth = async () => {
    if (!qrAuthAttempt || qrAuthBusy || qrAuthAttempt.verified || !/^\d{2}$/.test(qrAuthCode)) return;
    setQrAuthBusy(true);
    setQrAuthMessage("");
    try {
      const response = await fetch("/api/qr/order-auth/verify", { method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", cache: "no-store", body: JSON.stringify({ attemptId: qrAuthAttempt.attemptId, code: qrAuthCode }) });
      const result = await readJsonResponse(response, response.url, "API request") as { success?: boolean; verified?: boolean; code?: string; message?: string; attemptsRemaining?: number; requestExpiresAtMs?: number; codeExpiresAtMs?: number | null; serverNowMs?: number };
      if (result.attemptsRemaining !== undefined) setQrAuthAttemptsRemaining(result.attemptsRemaining);
      if (["CODE_EXPIRED", "ATTEMPT_EXPIRED", "ATTEMPTS_BLOCKED", "BLOCKED", "EXPIRED", "ATTEMPT_NOT_REUSABLE"].includes(result.code ?? "")) setQrAuthRequiresRestart(true);
      if (!response.ok || !result.success || !result.verified) throw new Error(result.message ?? "인증번호를 확인하지 못했습니다.");
      const verifiedAttempt = { ...qrAuthAttempt, state: "VERIFIED", verified: true,
        requestExpiresAtMs: result.requestExpiresAtMs ?? qrAuthAttempt.requestExpiresAtMs,
        codeExpiresAtMs: result.codeExpiresAtMs ?? qrAuthAttempt.codeExpiresAtMs,
        serverNowMs: result.serverNowMs ?? qrAuthAttempt.serverNowMs, expiresAtLocalMs: qrAuthAttempt.expiresAtLocalMs };
      setQrAuthAttempt(verifiedAttempt);
      setQrAuthMessage("");
      if (qrAuthStorageKey) {
        try {
          const stored = JSON.parse(localStorage.getItem(qrAuthStorageKey) ?? "null") as StoredQrAuthAttempt | null;
          if (stored?.requestId === qrAuthAttempt.requestId) localStorage.setItem(qrAuthStorageKey, JSON.stringify({ ...stored, verified: true }));
        } catch { /* Keep this-page verification state if storage is unavailable. */ }
      }
    } catch (error) { setQrAuthMessage(error instanceof Error ? error.message : "인증번호를 확인하지 못했습니다."); }
    finally { setQrAuthBusy(false); }
  };

  const closeQrAuthDialog = async (invalidate: boolean) => {
    if (qrAuthBusy) return;
    if (invalidate && qrAuthAttempt && !qrAuthAttempt.verified) {
      try { await fetch("/api/qr/order-auth", { method: "DELETE", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", cache: "no-store", body: JSON.stringify({ attemptId: qrAuthAttempt.attemptId }) }); } catch { /* The attempt expires server-side if offline. */ }
      if (qrAuthStorageKey) { try { localStorage.removeItem(qrAuthStorageKey); } catch { /* No storage available. */ } }
    }
    setQrAuthDialogOpen(false);
    setQrAuthCode("");
    setQrAuthMessage("");
    setQrAuthRequiresRestart(false);
  };

  useEffect(() => {
    if (!qrAuthDialogOpen || qrAuthAttempt?.verified) return;
    const timer = window.setInterval(() => setQrAuthNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [qrAuthDialogOpen, qrAuthAttempt?.verified]);

  useEffect(() => {
    if (!qrAuthFlowEnabled) return;
    let pending: AbortController | null = null;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      void refreshRepresentativeState(controller.signal).finally(() => {
        if (pending === controller) pending = null;
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      pending?.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [qrAuthFlowEnabled, refreshRepresentativeState]);

  const qrAuthDialogCopy = ({
    ko: { title: "매장 화면에 표시된 인증번호를 입력해주세요.", prompt: "인증번호 2자리", confirm: "확인", cancel: "취소", retry: "새 인증 요청", remaining: "남은 시간", expired: "인증 시간이 만료되었습니다. 새 인증을 요청해 주세요.", verified: "인증이 완료되었습니다.", submit: "주문 접수" },
    en: { title: "Enter the code shown on the store screen.", prompt: "2-digit code", confirm: "Verify", cancel: "Cancel", retry: "Request a new code", remaining: "Time left", expired: "The code expired. Request a new verification.", verified: "Verification complete.", submit: "Submit order" },
    "zh-CN": { title: "请输入店内屏幕上显示的验证码。", prompt: "2位验证码", confirm: "确认", cancel: "取消", retry: "重新请求验证码", remaining: "剩余时间", expired: "验证码已过期，请重新验证。", verified: "验证完成。", submit: "提交订单" },
    ja: { title: "店内画面に表示された認証番号を入力してください。", prompt: "2桁の番号", confirm: "確認", cancel: "キャンセル", retry: "認証番号を再リクエスト", remaining: "残り時間", expired: "認証の有効期限が切れました。再度お試しください。", verified: "認証が完了しました。", submit: "注文を送信" },
  } as Record<QrLocale, { title: string; prompt: string; confirm: string; cancel: string; retry: string; remaining: string; expired: string; verified: string; submit: string }>)[locale];
  const qrAuthRemainingSeconds = qrAuthAttempt ? Math.max(0, Math.ceil((qrAuthAttempt.expiresAtLocalMs - qrAuthNow) / 1000)) : 0;

  const editWaitOrder = () => {
    if (!waitOrder || waitOrder.status !== "PENDING") return;
    const restored = waitOrder.items.map(item => ({ menuId: item.menuId, qty: item.quantity, options: item.options }));
    setCart(catalog ? splitQrCartAddonLines(normalizeQrCart(restored, catalog), catalog) : restored);
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
      const payload = await readJsonResponse(response, response.url, "API request") as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "대기 주문을 취소하지 못했습니다.");
      setWaitOrder({ ...waitOrder, status: "CANCELLED" });
      try { localStorage.removeItem(QR_WAIT_ORDER_ID_KEY); } catch { /* current page state is sufficient */ }
    } catch (error) { setWaitError(error instanceof Error ? error.message : "대기 주문을 취소하지 못했습니다."); }
    finally { setWaitBusy(false); }
  };

  const requestQrExit = () => {
    if (waitingMode || (tableOrderMode && !cartReady)) return;
    setExitError("");
    setHistoryNoticeMessage("");
    if (tableOrderMode && cart.length === 0) {
      void moveToTableOrderHistory();
      return;
    }
    setExitDialogOpen(true);
  };

  const moveToTableOrderHistory = async () => {
    setExitBusy(true);
    setExitError("");
    try {
      const response = await fetch("/api/qr/table-orders", { cache: "no-store", credentials: "same-origin" });
      const payload = await readJsonResponse(response, response.url, "API request") as { success?: boolean; tableNo?: string; orders?: unknown[]; ownRequests?: unknown[]; posOrders?: unknown[] };
      if (!response.ok || !payload.success || !payload.tableNo) {
        throw new Error("유효한 테이블 주문 인증을 확인할 수 없습니다. 테이블 QR을 다시 스캔해 주세요.");
      }
      if (!Array.isArray(payload.orders)) throw new Error("주문내역을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      if (!hasQrOrderHistory([...(payload.ownRequests ?? []), ...(payload.posOrders ?? [])])) {
        const message = "아직 주문내역이 없습니다.";
        if (cart.length > 0) setExitError(message);
        else setHistoryNoticeMessage(message);
        return;
      }
      router.push("/qrorder");
    } catch (error) {
      const message = error instanceof Error ? error.message : "주문내역으로 이동하지 못했습니다.";
      if (cart.length > 0) {
        setExitError(message);
        setExitDialogOpen(true);
      } else {
        setHistoryNoticeMessage(message);
      }
    } finally {
      setExitBusy(false);
    }
  };

  const openTableQrShare = async () => {
    setTableQrOpen(true);
    setTableQrBusy(true);
    setTableQrError("");
    setTableQrNotice("");
    setTableQrUrl("");
    setTableQrImage("");
    setTableQrNo(null);
    try {
      const response = await fetch("/api/qr/table-order-link", { cache: "no-store", credentials: "same-origin" });
      const payload = await readJsonResponse(response, response.url, "API request").catch(() => null) as { success?: boolean; url?: unknown; tableNo?: unknown } | null;
      if (!response.ok || !payload?.success || typeof payload.url !== "string" || typeof payload.tableNo !== "string") {
        setTableQrError(response.status === 401
          ? "테이블 QR 인증이 만료되었습니다. 테이블 QR을 다시 스캔해 주세요."
          : "현재 테이블의 주문 QR을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      const image = await QRCode.toDataURL(payload.url, { width: 320, margin: 2, errorCorrectionLevel: "H" });
      setTableQrNo(payload.tableNo);
      setTableQrUrl(payload.url);
      setTableQrImage(image);
    } catch {
      setTableQrError("현재 테이블의 주문 QR을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setTableQrBusy(false);
    }
  };

  const copyTableQrLink = async () => {
    if (!tableQrUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(tableQrUrl);
      } else {
        const input = document.createElement("textarea");
        input.value = tableQrUrl;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Clipboard copy failed");
      }
      setTableQrNotice("주문 링크를 복사했습니다.");
    } catch {
      setTableQrNotice("링크를 복사하지 못했습니다. QR코드를 스캔하거나 공유하기를 이용해 주세요.");
    }
  };

  const shareTableQrLink = async () => {
    if (!tableQrUrl) {
      setTableQrNotice("QR 링크를 아직 불러오지 못했습니다.");
      return;
    }
    if (!navigator.share) {
      setTableQrNotice("이 브라우저에서는 공유 기능을 지원하지 않습니다. 링크 복사를 이용해 주세요.");
      return;
    }
    try {
      await navigator.share({ title: "탑동김치찌개 함께 주문하기", text: "같은 테이블에서 함께 메뉴를 골라주세요.", url: tableQrUrl });
      setTableQrNotice("");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setTableQrNotice("공유를 열지 못했습니다. 링크 복사를 이용해 주세요.");
    }
  };

  useEffect(() => {
    if (!tableQrOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [tableQrOpen]);

  const finishFrontQr = () => {
    setExitDialogOpen(false);
    try { window.close(); } catch { /* Browsers may refuse closing a tab not opened by script. */ }
    window.setTimeout(() => setFrontQrExited(true), 200);
  };

  if (frontQrExited) return <main className="grid min-h-svh place-items-center bg-white px-6 text-center text-slate-900">
    <p className="text-lg font-bold">메뉴 둘러보기를 종료했습니다.</p>
  </main>;

  return <main className="isolate min-h-svh bg-white text-slate-900" style={{ paddingBottom: tableOrderMode ? `calc(${cartPeekHeight}px + 40px + env(safe-area-inset-bottom))` : `${cartPeekHeight + 40}px`, ...(titleData.photos.length > 0 ? { paddingTop: "calc(75vw - clamp(32px, 8vw, 40px))" } : {}) }}>
    {tableOrderMode && quickAddFeedback && <div aria-live="polite" className="fixed inset-x-0 z-20 mx-auto w-fit max-w-[calc(100vw-2rem)] rounded-full bg-slate-900/90 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg" role="status" style={{ bottom: `calc(${cartPeekHeight}px + env(safe-area-inset-bottom) + 0.5rem)` }}>{quickAddFeedback}</div>}
    {titleData.photos.length > 0 && <QrTitleCarousel exitDisabled={tableOrderMode && !cartReady} fixedHero onExitRequest={!waitingMode ? requestQrExit : undefined} photos={titleData.photos} />}
    <div className="relative z-10" data-qr-content>
    {titleData.photos.length > 0 && <span aria-hidden="true" className="absolute left-0 top-0 h-px w-px" data-qr-content-start />}
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-0 bg-white top-[var(--qr-menu-backdrop-top,0px)]" data-qr-menu-backdrop />
    <QrStoreTitle fixedHero={titleData.photos.length > 0} menuOrderHeader notices={notices} onShareTableQr={tableOrderMode ? () => void openTableQrShare() : undefined} screenSettings={tableOrderMode ? titleData.screenSettings : undefined} settings={titleData} snapEnabled={titleData.photos.length > 0} tableOrderMode={tableOrderMode} />
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
        : <div aria-label="메뉴" className="min-h-[calc(100dvh-10rem)] py-2" data-qr-menu-page>
          {categoryMenuGroups.length === 0 ? <p className="px-2 py-8 text-center text-sm text-slate-500">{t.noMenus}</p> : categoryMenuGroups.map(({ category, menus }, categoryIndex) => <section aria-label={category.name} data-qr-category={category.categoryId} key={category.categoryId}>
            {categoryIndex > 0 && <QrDoubleDivider fullBleed />}
            <div className="mx-auto max-w-2xl px-3">
              <div className="divide-y divide-slate-200 rounded-2xl bg-white px-3">{menus.map(menu => {
                const shortDescription = locale === "ko" ? menu.shortDescription ?? "" : "";
                return <article className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_7rem] gap-x-3 py-3 text-left" key={menu.menuId} onClick={event => {
                  if (event.target instanceof Element && event.target.closest("button")) return;
                  openMenu(menu);
                }} ref={element => {
                  if (element) menuRowRefs.current.set(menu.menuId, element);
                  else menuRowRefs.current.delete(menu.menuId);
                }}>
                  <div className="grid min-h-28 min-w-0 grid-rows-[minmax(2.25rem,auto)_minmax(1.5rem,auto)_minmax(2.125rem,auto)] p-[3%]">
                    <button aria-label={`${menu.name} ${t.title}`} className="min-h-0 text-left active:opacity-70" onClick={() => openMenu(menu)} type="button">
                      <strong className="line-clamp-2 break-words text-[clamp(0.875rem,4.6vw,1.125rem)] font-extrabold leading-5">{menu.name}</strong>
                    </button>
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <button aria-label={`${menu.name} ${t.title}`} className="min-w-0 truncate text-left text-[clamp(0.875rem,4.4vw,1.125rem)] font-bold tabular-nums active:opacity-70" onClick={() => openMenu(menu)} type="button">{menuCardPrice(Number(menu.price), locale)}</button>
                    </div>
                    <span className="line-clamp-2 min-h-0 break-words whitespace-pre-line text-[12px] font-normal leading-[1.375] text-slate-500">{shortDescription}</span>
                  </div>
                  <div aria-label={`${menu.name} ${t.title}`} className="relative h-28 w-28 overflow-hidden rounded-xl bg-slate-100 text-left active:opacity-70" onClick={event => { event.stopPropagation(); openMenu(menu); }} onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openMenu(menu); }
                  }} role="button" tabIndex={0}>
                    {menu.imageUrl ? <Image alt="" className="h-full w-full object-cover" height={112} loading="lazy" src={menu.imageUrl} unoptimized width={112} /> : <span aria-label={t.noImage} className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-br from-amber-50 to-slate-100 text-3xl" role="img"><span aria-hidden="true">{"\uD83C\uDF72"}</span><span className="text-[10px] font-medium text-slate-500">{t.noImage}</span></span>}
                    {!waitingMode && <button aria-label={`${menu.name} ${t.add}`} className="absolute bottom-[1px] right-[1px] grid h-11 w-11 place-items-center rounded-full border-0 bg-transparent p-0 shadow-none transition active:scale-95 disabled:opacity-50" disabled={!cartReady} onClick={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      quickAddMenu(menu);
                    }} type="button"><QrMenuAddIcon className="pointer-events-none h-[25px] w-[25px] overflow-visible" /></button>}
                  </div>
                </article>;
              })}</div>
            </div>
          </section>)}
          <div aria-hidden="true" className="bg-white" ref={menuBottomSpacerRef} style={{ height: 0 }} />
        </div>}
    </div>

    {cartSheetOpen && <button aria-label={t.close} className="fixed inset-0 z-30 bg-slate-950/45 transition-opacity duration-300 ease-out motion-reduce:transition-none" onClick={() => closeCartSheet()} type="button" />}
    <section aria-label={t.cart} aria-modal={cartSheetOpen ? "true" : undefined} className={`fixed inset-x-0 bottom-0 z-40 mx-auto flex h-[82dvh] max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl ${tableOrderMode ? "bg-white" : "bg-blue-700"} pb-[max(1rem,env(safe-area-inset-bottom))] text-white shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${cartSheetOpen ? "translate-y-0" : cartHasItems ? "translate-y-[calc(100%-57.6px)]" : "translate-y-[calc(100%-17.28px)]"}`} data-qr-cart-sheet role={cartSheetOpen ? "dialog" : "region"}>
      <div className="relative shrink-0">
        <button aria-expanded={cartSheetOpen} aria-label={cartSheetOpen ? t.cart + " " + t.close : t.cart} className={`z-10 flex w-full flex-col items-center justify-center overflow-hidden text-left transition-[height,padding] duration-300 ease-out motion-reduce:transition-none ${tableOrderMode ? "bg-blue-700" : ""} ${cartHeaderVisible ? "h-[57.6px] px-4 pb-[9.6px] pt-[6.4px]" : "h-[17.28px] px-0 py-0"}`} onClick={toggleCartSheet} onTouchStart={handleCartHeaderTouchStart} onTouchEnd={handleCartHeaderTouchEnd} type="button">
          <span aria-hidden="true" className={`h-1 w-10 shrink-0 rounded-full bg-white/90 ${cartHeaderVisible ? "mb-[6.4px]" : ""}`} />
          {cartHeaderVisible && <span className={`flex w-full max-w-xl items-center gap-2 ${tableOrderMode ? "pr-12" : "justify-between"}`}>
            <span className="flex min-w-0 items-center gap-2 font-extrabold">{cartHasItems && <span aria-label={`${itemCount}개`} className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 px-2 py-1 text-xs font-extrabold leading-none tabular-nums text-blue-800">{itemCount}</span>}<span className="truncate">{t.cart}</span></span>
            {cartHasItems && <span className={`min-w-0 truncate text-right text-sm font-bold tabular-nums ${tableOrderMode ? "ml-auto" : "shrink-0"}`}>{formatQrCartPrice(total)}</span>}
          </span>}
        </button>
        {tableOrderMode && cartHasItems && <div className="pointer-events-none absolute inset-x-4 top-[6.8px] z-20 mx-auto flex max-w-xl justify-end">
          <button aria-label="장바구니 비우기" className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-lg text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={() => setClearCartDialogOpen(true)} type="button"><svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v7m4-7v7" /></svg></button>
        </div>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col bg-slate-50 text-slate-900" inert={!cartSheetOpen}>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {cart.length === 0 ? <p className="py-10 text-center text-slate-500">{t.empty}</p> : <div className="divide-y divide-slate-100">{cart.map((line, index) => {
            const menu = catalog?.menus.find(item => item.menuId === line.menuId);
            if (!menu) return null;
            const optionNames = line.options.map(selected => { const group = menu.groups.find(candidate => candidate.options.some(option => option.modifierOptionId === selected.modifierOptionId)); const option = group?.options.find(candidate => candidate.modifierOptionId === selected.modifierOptionId); return option ? `${option.optionName}${group?.source === "MENU_ADDON" ? ` ×${selected.qty}` : ""}` : ""; }).filter(Boolean);
            return <div className="py-3" key={line.menuId + "-" + line.options.map(option => option.modifierOptionId).join("-") + "-" + index}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1">
                    <strong className={optionNames.length ? "max-w-[70%] shrink-0 truncate" : "min-w-0 flex-1 truncate"}>{menu.name}</strong>
                    {optionNames.length > 0 && <span className="min-w-0 flex-1 truncate text-xs font-normal text-slate-500">{optionNames.join(" · ")}</span>}
                  </div>
                  <p className="mt-1 text-sm font-bold tabular-nums">{formatQrCartPrice(qrLineTotal(menu, line.options, line.qty))}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button aria-label={menu.name + " " + t.qty + " -"} className="h-9 w-9 rounded-full bg-slate-100 font-bold" onClick={() => changeCartQty(line, -1)} type="button">-</button>
                  <span className="min-w-5 text-center tabular-nums">{line.qty}</span>
                  <button aria-label={menu.name + " " + t.qty + " +"} className="h-9 w-9 rounded-full bg-slate-100 font-bold" onClick={() => changeCartQty(line, 1)} type="button">+</button>
                  <button aria-label={menu.name + " " + t.remove} className="ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#8B95A3] transition-colors hover:text-[#687280] active:text-[#687280] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#687280]" onClick={() => removeCartLine(line)} type="button"><svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v7m4-7v7" /></svg></button>
                </div>
              </div>
            </div>;
          })}</div>}
        </div>
        <div className="shrink-0 border-t border-slate-200 bg-white px-4 pb-2 pt-3"><div className="mx-auto max-w-xl">
          {waitingMode && <>{waitError && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{waitError}</p>}<button className="mt-3 min-h-12 w-full rounded-xl bg-blue-600 font-extrabold text-white disabled:opacity-50" disabled={!cart.length || waitBusy || Boolean(waitOrder && ["PENDING", "ASSIGNED"].includes(waitOrder.status) && !editingWaitOrder)} onClick={() => void submitWaitOrder()} type="button">{waitBusy ? "\uCC98\uB9AC \uC911..." : editingWaitOrder ? "\uB300\uAE30 \uC8FC\uBB38 \uC218\uC815 \uC800\uC7A5" : "\uB300\uAE30 \uC8FC\uBB38 \uB4F1\uB85D"}</button></>}
          {tableOrderMode && <>
            {qrAuthFlowEnabled && representativeState === "OWN_PENDING" && <p className="mt-3 text-sm font-semibold text-slate-700" role="status">주문 승인 대기 중</p>}
            {waitError && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{waitError}</p>}
            {qrAuthFlowEnabled && cart.length > 0 && ["OTHER_PENDING", "OTHER_CONFIRMED"].includes(representativeState) &&
              <p className="mt-3 text-sm font-medium leading-5 text-slate-600" role="status">현재 주문 중인 기기에서만 주문을 전송할 수 있습니다.</p>}
            <button className="mt-3 min-h-12 w-full rounded-xl bg-blue-600 font-extrabold text-white disabled:opacity-50"
              disabled={!cart.length || tableOrderBusy || (qrAuthFlowEnabled && representativeState !== "NO_REPRESENTATIVE" && representativeState !== "OWN_CONFIRMED")}
              onClick={() => void submitTableOrder()} type="button">{tableOrderBusy ? "처리 중..." : "주문 전송"}</button>
          </>}
          {!waitingMode && !tableOrderMode && <a className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-amber-50 text-sm font-bold text-amber-900" href="/qr/wait">{"\uB300\uAE30 QR\uC5D0\uC11C \uB300\uAE30 \uC8FC\uBB38 \uB4F1\uB85D"}</a>}
        </div></div>
      </div>
    </section>

    {qrAuthDialogOpen && <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" onClick={() => void closeQrAuthDialog(!qrAuthAttempt?.verified)}>
      <section aria-labelledby="qr-order-auth-title" aria-modal="true" className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="dialog">
        <h2 className="text-lg font-extrabold text-slate-900" id="qr-order-auth-title">{qrAuthDialogCopy.title}</h2>
        {qrAuthAttempt?.verified ? <>
          <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800" role="status">{qrAuthDialogCopy.verified}</p>
          {qrAuthMessage && <p className="mt-2 text-sm font-semibold text-red-600" role="alert">{qrAuthMessage}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2"><button className="min-h-12 rounded-xl border border-slate-200 font-bold text-slate-700" disabled={qrAuthBusy} onClick={() => void closeQrAuthDialog(false)} type="button">{qrAuthDialogCopy.cancel}</button>
            <button className="min-h-12 rounded-xl bg-blue-700 font-bold text-white disabled:opacity-50" disabled={qrAuthBusy} onClick={() => void submitVerifiedQrOrder()} type="button">{qrAuthBusy ? "…" : qrAuthDialogCopy.submit}</button></div>
        </> : <>
          <label className="mt-5 block text-sm font-semibold text-slate-700" htmlFor="qr-order-auth-code">{qrAuthDialogCopy.prompt}</label>
          <input autoComplete="one-time-code" autoFocus className="mt-2 h-16 w-full rounded-xl border border-slate-300 bg-slate-50 text-center text-3xl font-extrabold tracking-[0.5em] text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" disabled={qrAuthBusy || qrAuthRemainingSeconds === 0} id="qr-order-auth-code" inputMode="numeric" maxLength={2} onChange={event => setQrAuthCode(event.target.value.replace(/\D/g, "").slice(0, 2))} pattern="[0-9]*" placeholder="00" type="text" value={qrAuthCode} />
          <p className={`mt-3 text-center text-sm font-semibold ${qrAuthRemainingSeconds === 0 ? "text-red-600" : "text-slate-600"}`} aria-live="polite">
            {qrAuthRemainingSeconds === 0 ? qrAuthDialogCopy.expired : `${qrAuthDialogCopy.remaining}: ${Math.floor(qrAuthRemainingSeconds / 60)}:${String(qrAuthRemainingSeconds % 60).padStart(2, "0")} · ${qrAuthAttemptsRemaining}/3`}
          </p>
          {qrAuthMessage && <p className="mt-2 text-center text-sm font-semibold text-red-600" role="alert">{qrAuthMessage}</p>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-700 disabled:opacity-50" disabled={qrAuthBusy} onClick={() => void closeQrAuthDialog(true)} type="button">{qrAuthDialogCopy.cancel}</button>
            {qrAuthRemainingSeconds === 0 || qrAuthAttemptsRemaining === 0 || qrAuthRequiresRestart ?
              <button className="min-h-12 rounded-xl bg-blue-700 px-3 font-bold text-white disabled:opacity-50" disabled={qrAuthBusy} onClick={async () => { await closeQrAuthDialog(true); void submitTableOrder(); }} type="button">{qrAuthDialogCopy.retry}</button> :
              <button className="min-h-12 rounded-xl bg-blue-700 px-3 font-bold text-white disabled:opacity-50" disabled={qrAuthBusy || qrAuthCode.length !== 2} onClick={() => void verifyQrOrderAuth()} type="button">{qrAuthBusy ? "…" : qrAuthDialogCopy.confirm}</button>}
          </div>
        </>}
      </section>
    </div>}

    {clearCartDialogOpen && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onClick={() => setClearCartDialogOpen(false)}>
      <section aria-labelledby="qr-clear-cart-title" aria-modal="true" className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="alertdialog">
        <h2 className="text-lg font-extrabold" id="qr-clear-cart-title">장바구니를 모두 비우시겠습니까?</h2>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-700" onClick={() => setClearCartDialogOpen(false)} type="button">취소</button>
          <button className="min-h-12 rounded-xl bg-blue-700 px-3 font-bold text-white" onClick={clearCart} type="button">비우기</button>
        </div>
      </section>
    </div>}

    {view && currentMenu && <section aria-label={currentMenu.name ?? t.title} aria-modal="true" className={`fixed inset-y-0 left-1/2 z-50 flex h-[100dvh] w-full max-w-2xl flex-col overflow-hidden bg-white transition-transform ${viewDragActive ? "duration-0" : "duration-[250ms] ease-out"} motion-reduce:duration-0`} onPointerDown={event => {
      const target = event.target as HTMLElement;
      const isTouchPointer = event.pointerType === "touch" || event.pointerType === "pen";
      detailGestureRef.current = {
        x: event.clientX,
        y: event.clientY,
        startedAt: performance.now(),
        width: event.currentTarget.getBoundingClientRect().width,
        carousel: Boolean(target.closest("[data-menu-detail-carousel]")),
        edge: isTouchPointer && event.clientX <= 24,
        cancelled: false,
      };
    }} onPointerMove={event => {
      const start = detailGestureRef.current;
      if (!start?.edge || start.carousel || start.cancelled) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) {
        start.cancelled = true;
        setViewDragActive(false);
        setViewOffsetX(0);
        return;
      }
      if (dx <= 0 || Math.abs(dx) < Math.abs(dy)) return;
      setViewDragActive(true);
      setViewOffsetX(Math.min(100, dx / Math.max(1, start.width) * 100));
    }} onPointerUp={event => {
      const start = detailGestureRef.current;
      detailGestureRef.current = null;
      setViewDragActive(false);
      if (!start) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (start.carousel) {
        if (Math.abs(dx) >= 70 && Math.abs(dy) <= Math.abs(dx) * 0.8) {
          setDetailImageIndex(index => Math.max(0, Math.min(currentDetailImages.length - 1, index + (dx < 0 ? 1 : -1))));
          suppressDetailImageClickRef.current = true;
          window.setTimeout(() => { suppressDetailImageClickRef.current = false; }, 300);
        }
        setViewOffsetX(0);
        return;
      }
      const elapsed = Math.max(1, performance.now() - start.startedAt);
      const velocity = dx / elapsed;
      if (start.edge && !start.cancelled && dx >= 70 && Math.abs(dy) <= Math.abs(dx) * 0.8 && velocity >= 0.25) closeView();
      else setViewOffsetX(0);
    }} onPointerCancel={() => {
      detailGestureRef.current = null;
      setViewDragActive(false);
      setViewOffsetX(0);
    }} role="dialog" style={{ transform: `translateX(calc(-50% + ${viewOffsetX}%))`, touchAction: "pan-y" }}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-5">
        <div className="relative w-full bg-slate-100" data-menu-detail-carousel style={{ aspectRatio: "2 / 1", maxHeight: 240 }}>
          {currentDetailImages.length ? <Image alt={`${currentMenu.name} ${detailImageIndex + 1}`} className="h-full w-full cursor-zoom-in object-cover" height={360} onClick={event => {
            event.stopPropagation();
            if (suppressDetailImageClickRef.current) { suppressDetailImageClickRef.current = false; return; }
            openDetailGallery();
          }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetailGallery(); } }} priority role="button" tabIndex={0} src={currentDetailImages[Math.min(detailImageIndex, currentDetailImages.length - 1)]} unoptimized width={720} /> : <div className="grid h-full w-full place-items-center text-sm text-slate-400">{t.noImage}</div>}
          <button aria-label="닫기" className="absolute right-4 top-4 z-10 grid h-12 w-12 place-items-center rounded-full text-white shadow-md" onClick={() => spiceSheetOpenRef.current ? closeSpiceSheet() : originSheetOpenRef.current ? closeOriginSheet() : closeView()} style={{ backgroundColor: "rgba(60, 64, 70, 0.75)" }} type="button"><svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
          {currentDetailImages.length > 1 && <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white"><span>{currentDetailImages.map((_, index) => <button aria-label={`이미지 ${index + 1}`} className={`mx-0.5 inline-block h-2 w-2 rounded-full ${index === detailImageIndex ? "bg-white" : "bg-white/50"}`} key={index} onClick={() => setDetailImageIndex(index)} type="button" />)}</span><span>{detailImageIndex + 1} / {currentDetailImages.length}</span></div>}
        </div>
        <div className="px-4 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
              <h2 className="min-w-0 max-w-full break-words text-xl font-extrabold">{currentMenu.name}</h2>
              {hasOriginDescription && <button className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-1 text-sm font-semibold leading-6 text-slate-600" onClick={openOriginSheet} type="button">
                <span>{locale === "ko" ? "원산지정보" : locale === "en" ? "Origin" : locale === "ja" ? "原産地" : "原产地"}</span>
                <span aria-hidden="true">&gt;</span>
              </button>}
            </div>
            <strong className="shrink-0 whitespace-nowrap text-base font-bold tabular-nums">{menuCardPrice(Number(currentMenu.price), locale)}</strong>
          </div>
          {currentMenu.detailDescription?.trim() && <p className="mt-3 w-full break-words whitespace-pre-line text-sm leading-6 text-slate-600">{currentMenu.detailDescription}</p>}
          <div className="mt-4 border-y border-slate-200 py-3"><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"><span className="font-semibold text-slate-600">{t.qty}</span><div className="flex items-center justify-self-center gap-2"><button aria-label="−" className="h-10 w-10 rounded-full bg-slate-100 text-xl font-bold" onClick={() => setQuantity(value => Math.max(1, value - 1))} type="button">−</button><span className="min-w-5 text-center text-lg font-bold tabular-nums">{quantity}</span><button aria-label="+" className="h-10 w-10 rounded-full bg-slate-100 text-xl font-bold" onClick={() => setQuantity(value => Math.min(99, value + 1))} type="button">+</button></div><strong className="justify-self-end whitespace-nowrap text-right text-base font-bold tabular-nums">{menuCardPrice(Number(currentMenu.price) * quantity, locale)}</strong></div></div>
          {spiceGroup && <button aria-expanded={spiceSheetOpen} aria-haspopup="dialog" className={`flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left ${keepSpiceBottomBorder ? "border-b border-slate-100" : ""}`} onClick={openSpiceSheet} type="button"><span className="whitespace-nowrap font-bold">맵기 선택</span><span className="flex min-w-0 items-center gap-2"><span className="min-w-0 truncate text-base font-semibold text-slate-600">{selectedSpiceOption ? qrOptionLabel(selectedSpiceOption, locale) : "선택해 주세요"}</span><svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></span></button>}
          {view.type === "menu" && currentMenu && <>
            {otherRequiredGroups.map(group => <fieldset className="border-b border-slate-100 py-4" key={group.modifierGroupId}><legend className="mb-2 flex w-full items-center justify-between gap-2 font-extrabold">{group.name}{group.maxSelect > 1 ? <span className="text-xs font-semibold text-slate-500">{group.minSelect}–{group.maxSelect}</span> : null}</legend><div className="space-y-1">{group.options.map(option => {
              const selected = (selections[group.modifierGroupId] ?? []).includes(option.modifierOptionId);
              return <label className={`flex min-h-12 items-center gap-3 rounded-xl px-3 ${selected ? "bg-blue-50 text-blue-800" : "bg-slate-50"}`} key={option.modifierOptionId}><input checked={selected} className="h-5 w-5 accent-blue-600" name={`group-${group.modifierGroupId}`} onChange={() => toggleOption(group.modifierGroupId, option.modifierOptionId, group.maxSelect > 1, group.maxSelect)} type={group.maxSelect > 1 ? "checkbox" : "radio"} /><span className="min-w-0 flex-1 font-semibold">{qrOptionLabel(option, locale)}</span>{Number(option.priceDelta) !== 0 && <span className="shrink-0 text-sm tabular-nums text-slate-600">{Number(option.priceDelta) > 0 ? "+" : "−"}{won(Math.abs(Number(option.priceDelta)), locale)}</span>}</label>;
            })}</div></fieldset>)}
            {otherOptionalGroups.length > 0 && <section className="py-4"><h3 className="mb-2 font-extrabold">기타 옵션</h3>{otherOptionalGroups.map(group => <fieldset className="border-b border-slate-100 py-3" key={group.modifierGroupId}><legend className="mb-2 flex w-full items-center justify-between gap-2 font-bold">{group.name}{group.maxSelect > 1 ? <span className="text-xs font-semibold text-slate-500">최대 {group.maxSelect}개</span> : null}</legend><div className="space-y-1">{group.maxSelect <= 1 && <label className="flex min-h-12 items-center gap-3 rounded-xl bg-slate-50 px-3"><input checked={(selections[group.modifierGroupId] ?? []).length === 0} className="h-5 w-5 accent-blue-600" name={`group-${group.modifierGroupId}`} onChange={() => setSelections(current => ({ ...current, [group.modifierGroupId]: [] }))} type="radio" /><span className="font-semibold">{t.none}</span></label>}{group.options.map(option => { const selected = (selections[group.modifierGroupId] ?? []).includes(option.modifierOptionId); return <label className={`flex min-h-12 items-center gap-3 rounded-xl px-3 ${selected ? "bg-blue-50 text-blue-800" : "bg-slate-50"}`} key={option.modifierOptionId}><input checked={selected} className="h-5 w-5 accent-blue-600" name={`group-${group.modifierGroupId}`} onChange={() => toggleOption(group.modifierGroupId, option.modifierOptionId, group.maxSelect > 1, group.maxSelect)} type={group.maxSelect > 1 ? "checkbox" : "radio"} /><span className="min-w-0 flex-1 font-semibold">{qrOptionLabel(option, locale)}</span>{Number(option.priceDelta) !== 0 && <span className="shrink-0 text-sm tabular-nums text-slate-600">{Number(option.priceDelta) > 0 ? "+" : "−"}{won(Math.abs(Number(option.priceDelta)), locale)}</span>}</label>; })}</div></fieldset>)}</section>}
            {addonDisplayEntries.length > 0 && (
  <section className={spiceGroup ? "pb-4" : "py-4"}>
    {spiceGroup && <div className="-mx-4 flex h-6 items-center"><QrDoubleDivider /></div>}
    <h3 className="mt-3 mb-2 font-extrabold">{"\uCD94\uAC00\uBA54\uB274"}</h3>
    <div className="space-y-1">
      {addonDisplayEntries.map(entry => {
        if (entry.type === "divider") return <div aria-orientation="horizontal" className="mx-3 my-2 border-t border-slate-200" key={entry.entryId} role="separator" />;
        if (entry.type === "spacer") return <div aria-hidden="true" className="h-5" key={entry.entryId} />;
        const option = addonOptionById.get(entry.entryId);
        if (!option) return null;
        const addonQty = addonQuantities[option.modifierOptionId] ?? 0;
        const selected = addonQty > 0;
        const displayPrice = Number(entry.price) * (selected ? addonQty : 1);
        return (
          <div
            className={`grid min-h-12 grid-cols-[minmax(0,1fr)_5.25rem_minmax(4.5rem,auto)] items-center gap-2 rounded-xl px-3 ${selected ? "bg-blue-50 text-blue-800" : "bg-slate-50"}`}
            key={entry.entryId}
          >
            <label className="flex min-w-0 items-center gap-2">
              <input
                aria-label={option.optionName}
                checked={selected}
                className="h-5 w-5 shrink-0 accent-blue-600"
                onChange={() => toggleAddon(option.modifierOptionId)}
                type="checkbox"
              />
              <span className="min-w-0 truncate font-semibold">{qrOptionLabel(option, locale)}</span>
            </label>
            <div className="flex items-center justify-center gap-1" role="group" aria-label={selected ? `Quantity ${addonQty}` : undefined}>
              {selected && <>
                <button aria-label={`Decrease ${option.optionName} quantity`} className="h-7 w-7 shrink-0 rounded-full bg-white font-bold" onClick={() => changeAddonQty(option.modifierOptionId, -1)} type="button">−</button>
                <span className="min-w-4 text-center font-bold tabular-nums">{addonQty}</span>
                <button aria-label={`Increase ${option.optionName} quantity`} className="h-7 w-7 shrink-0 rounded-full bg-white font-bold" onClick={() => changeAddonQty(option.modifierOptionId, 1)} type="button">+</button>
              </>}
            </div>
            <span className="whitespace-nowrap text-right text-sm tabular-nums text-slate-600">{menuCardPrice(displayPrice, "ko")}</span>
          </div>
        );
      })}
    </div>
  </section>
)}
            {selectionError && <p className="mt-3 text-sm font-semibold text-red-600" role="alert">{selectionError}</p>}
          </>}
        </div>
      </div>
      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"><button className="mx-auto flex min-h-14 w-full max-w-xl items-center justify-between rounded-xl bg-blue-600 px-4 font-extrabold text-white" onClick={addCurrentMenu} type="button"><span>{t.add} ({qrLineItemCount(currentMenu, quantity, selectedQrOptions(currentMenu.groups, getCurrentSelections(), addonQuantities))}{t.count})</span><span>{formatQrCartPrice(qrLineTotal(currentMenu, selectedQrOptions(currentMenu.groups, getCurrentSelections(), addonQuantities), quantity))}</span></button></footer>
    </section>}

    {spiceSheetOpen && spiceGroup && <div aria-label="맵기 선택" className={`fixed inset-0 z-[70] flex items-end justify-center bg-black/45 transition-opacity duration-300 motion-reduce:transition-none ${spiceSheetVisible ? "opacity-100" : "opacity-0"}`} onClick={() => closeSpiceSheet()}>
      <section aria-labelledby="qr-spice-sheet-title" aria-modal="true" className={`flex max-h-[78dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${spiceSheetVisible ? "translate-y-0" : "translate-y-full"}`} onClick={event => event.stopPropagation()} role="dialog">
        <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-100 px-5">
          <h2 className="text-lg font-extrabold" id="qr-spice-sheet-title">맵기 선택</h2>
          <button aria-label="맵기 선택 닫기" className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-xl font-bold text-slate-600" onClick={() => closeSpiceSheet()} type="button">×</button>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 py-4">
          {spiceGroup.options.map(option => {
            const selected = (selections[spiceGroup.modifierGroupId] ?? []).includes(option.modifierOptionId);
            return <button aria-pressed={selected} className={`flex min-h-14 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${selected ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-slate-50 text-slate-800"}`} key={option.modifierOptionId} onClick={() => {
              if (!selected) toggleOption(spiceGroup.modifierGroupId, option.modifierOptionId, spiceGroup.maxSelect > 1, spiceGroup.maxSelect);
              closeSpiceSheet();
            }} type="button">
              <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? "border-blue-600" : "border-slate-400"}`}>{selected && <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />}</span>
              <span className="min-w-0 flex-1 break-words font-semibold leading-snug">{qrOptionLabel(option, locale)}</span>
              {Number(option.priceDelta) !== 0 && <span className="shrink-0 text-sm tabular-nums text-slate-600">{Number(option.priceDelta) > 0 ? "+" : "−"}{won(Math.abs(Number(option.priceDelta)), locale)}</span>}
            </button>;
          })}
        </div>
      </section>
    </div>}
    {originSheetOpen && currentMenu && <div className={`fixed inset-0 z-[60] flex items-end justify-center bg-black/40 transition-opacity duration-[250ms] ease-out motion-reduce:transition-none ${originSheetVisible ? "opacity-100" : "opacity-0"}`} onClick={() => closeOriginSheet()}><section aria-label="원산지 정보" aria-modal="true" className={`flex max-h-[70dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-xl transition-transform duration-[250ms] ease-out motion-reduce:transition-none ${originSheetVisible ? "translate-y-0" : "translate-y-full"}`} onClick={event => event.stopPropagation()} role="dialog">
      <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-100 px-5" onPointerDown={event => { originDragStartRef.current = event.clientY; }} onPointerUp={event => { const start = originDragStartRef.current; originDragStartRef.current = null; if (start !== null && event.clientY - start > 55) closeOriginSheet(); }}>
        <h2 className="text-lg font-extrabold">원산지 정보</h2>
        <button aria-label="원산지 정보 닫기" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700" onClick={() => closeOriginSheet()} type="button"><svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4">
        {hasOriginDescription
          ? <p className="mt-0 whitespace-pre-wrap break-words pb-3 pt-1 text-left text-sm leading-6 text-slate-700">{originTextRuns.map((run, index) => run.bold ? <strong className="font-bold" key={index}>{run.text}</strong> : <span key={index}>{run.text}</span>)}</p>
          : <p className="py-6 text-center text-sm text-slate-500">등록된 원산지 정보가 없습니다.</p>}
      </div>
    </section></div>}

    </div>
    {tableQrOpen && <div className="fixed inset-0 z-[130] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" onClick={() => setTableQrOpen(false)}>
      <section aria-labelledby="qr-table-share-title" aria-modal="true" className="max-h-[min(92dvh,44rem)] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="dialog">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900" id="qr-table-share-title">함께 주문하기</h2>
            {tableQrNo !== null && <p className="mt-1 text-sm font-semibold text-slate-600">{tableQrNo} 테이블</p>}
          </div>
          <button aria-label="닫기" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700" onClick={() => setTableQrOpen(false)} type="button">
            <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <p className="mt-3 text-center text-sm text-slate-600">함께 주문할 사람에게 QR을 공유하세요.</p>
        <div className="mx-auto mt-4 grid aspect-square w-[min(72vw,18rem)] place-items-center rounded-2xl border border-slate-200 bg-white p-2">
          {tableQrBusy
            ? <span className="text-sm font-medium text-slate-500">주문 QR을 불러오는 중…</span>
            : tableQrImage
              ? <Image alt={`${tableQrNo ?? "현재 테이블"} 테이블 함께 주문 QR`} className="h-full w-full object-contain" height={320} priority src={tableQrImage} unoptimized width={320} />
              : <span className="px-4 text-center text-sm font-medium text-slate-500">QR을 표시할 수 없습니다.</span>}
        </div>
        {tableQrError && <p className="mt-3 text-center text-sm font-semibold text-red-700" role="alert">{tableQrError}</p>}
        {tableQrNotice && <p className="mt-3 text-center text-sm font-semibold text-slate-700" role="status">{tableQrNotice}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="min-h-12 rounded-xl border border-blue-700 px-3 font-bold text-blue-700 disabled:opacity-50" disabled={!tableQrUrl || tableQrBusy} onClick={() => void copyTableQrLink()} type="button">링크 복사</button>
          <button className="min-h-12 rounded-xl bg-blue-700 px-3 font-bold text-white disabled:opacity-50" disabled={!tableQrUrl || tableQrBusy} onClick={() => void shareTableQrLink()} type="button">공유하기</button>
        </div>
      </section>
    </div>}
    {historyNoticeMessage && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onClick={() => setHistoryNoticeMessage("")}>
      <section aria-labelledby="qr-history-notice-title" aria-modal="true" className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="alertdialog">
        <h2 className="text-lg font-extrabold" id="qr-history-notice-title">주문내역</h2>
        <p className="mt-2 text-sm text-slate-600">{historyNoticeMessage}</p>
        <button className="mt-5 min-h-12 w-full rounded-xl bg-blue-700 font-bold text-white" onClick={() => setHistoryNoticeMessage("")} type="button">확인</button>
      </section>
    </div>}
    {exitDialogOpen && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onClick={() => { if (!exitBusy) setExitDialogOpen(false); }}>
      <section aria-labelledby="qr-exit-title" aria-modal="true" className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="dialog">
        <h2 className="text-lg font-extrabold" id="qr-exit-title">{tableOrderMode ? "주문내역으로 이동할까요?" : "TDKON을 종료할까요?"}</h2>
        {tableOrderMode && cart.length > 0 && <p className="mt-2 text-sm text-slate-600">장바구니에 담긴 메뉴가 있습니다.</p>}
        {exitError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{exitError}</p>}
        {tableOrderMode
          ? <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-700 disabled:opacity-50" disabled={exitBusy} onClick={() => { setExitDialogOpen(false); setExitError(""); }} type="button">계속 주문</button>
              <button className="min-h-12 rounded-xl bg-blue-700 px-3 font-bold text-white disabled:opacity-50" disabled={exitBusy || exitError === "아직 주문내역이 없습니다."} onClick={() => void moveToTableOrderHistory()} type="button">{exitBusy ? "확인 중..." : "주문내역"}</button>
            </div>
          : <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 font-bold text-slate-700" onClick={() => setExitDialogOpen(false)} type="button">취소</button>
              <button className="min-h-12 rounded-xl bg-slate-900 px-3 font-bold text-white" onClick={finishFrontQr} type="button">종료</button>
            </div>}
      </section>
    </div>}
    {detailGalleryOpen && currentMenu && currentDetailImages.length > 0 && <div aria-label={`${currentMenu.name} 이미지 갤러리`} aria-modal="true" className="fixed inset-0 z-[100] flex h-[100dvh] w-full touch-none select-none flex-col items-center justify-center bg-black text-white" onClick={event => event.stopPropagation()} role="dialog" onWheel={event => {
      event.preventDefault();
      const nextScale = Math.max(1, Math.min(4, galleryScale * (event.deltaY < 0 ? 1.15 : 0.87)));
      const limits = galleryOffsetLimits(nextScale);
      setGalleryScale(nextScale);
      setGalleryOffset(current => ({ x: Math.max(-limits.x, Math.min(limits.x, current.x)), y: Math.max(-limits.y, Math.min(limits.y, current.y)) }));
    }}>
      <button aria-label="이미지 갤러리 닫기" className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 grid h-12 w-12 place-items-center rounded-full bg-slate-800/85 text-white shadow-lg" onClick={() => closeDetailGallery()} type="button"><svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden" onPointerDown={event => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const points = galleryPointersRef.current;
        points.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (points.size === 1) galleryGestureRef.current = { x: event.clientX, y: event.clientY, offsetX: galleryOffset.x, offsetY: galleryOffset.y, distance: 0, scale: galleryScale, pointerType: event.pointerType, mode: galleryScale > 1 ? "pan" : "swipe" };
        else if (points.size >= 2) {
          const pair = [...points.values()].slice(0, 2);
          galleryGestureRef.current = { x: 0, y: 0, offsetX: galleryOffset.x, offsetY: galleryOffset.y, distance: Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y), scale: galleryScale, pointerType: event.pointerType, mode: "pinch" };
        }
      }} onPointerMove={event => {
        const points = galleryPointersRef.current;
        if (!points.has(event.pointerId)) return;
        points.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const gesture = galleryGestureRef.current;
        if (!gesture) return;
        if (points.size >= 2) {
          const pair = [...points.values()].slice(0, 2);
          const distance = Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y);
          const nextScale = Math.max(1, Math.min(4, gesture.scale * distance / Math.max(1, gesture.distance)));
          setGalleryScale(nextScale);
          const { x: limitX, y: limitY } = galleryOffsetLimits(nextScale);
          setGalleryOffset(current => ({ x: Math.max(-limitX, Math.min(limitX, current.x)), y: Math.max(-limitY, Math.min(limitY, current.y)) }));
          return;
        }
        if (gesture.mode !== "pan") return;
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        const { x: limitX, y: limitY } = galleryOffsetLimits(galleryScale);
        setGalleryOffset({ x: Math.max(-limitX, Math.min(limitX, gesture.offsetX + dx)), y: Math.max(-limitY, Math.min(limitY, gesture.offsetY + dy)) });
      }} onPointerUp={event => {
        const gesture = galleryGestureRef.current;
        const dx = event.clientX - (gesture?.x ?? event.clientX);
        const dy = event.clientY - (gesture?.y ?? event.clientY);
        galleryPointersRef.current.delete(event.pointerId);
        if (galleryPointersRef.current.size === 1) {
          const remaining = [...galleryPointersRef.current.values()][0];
          galleryGestureRef.current = { x: remaining.x, y: remaining.y, offsetX: galleryOffset.x, offsetY: galleryOffset.y, distance: 0, scale: galleryScale, pointerType: event.pointerType, mode: galleryScale > 1 ? "pan" : "swipe" };
          return;
        }
        galleryGestureRef.current = null;
        if (gesture?.mode === "swipe" && galleryScale === 1) {
          if (Math.abs(dx) >= 55 && Math.abs(dy) <= Math.abs(dx) * 0.8) changeGalleryImage(dx < 0 ? 1 : -1);
          else if (gesture.pointerType !== "mouse" && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
            const now = performance.now();
            if (now - galleryLastTapRef.current < 320) toggleGalleryZoom();
            galleryLastTapRef.current = now;
          }
        }
      }} onPointerCancel={event => { galleryPointersRef.current.delete(event.pointerId); galleryGestureRef.current = null; }} ref={galleryViewportRef}>
        <Image alt={`${currentMenu.name} ${detailImageIndex + 1}`} className="max-h-full max-w-full object-contain transition-transform duration-150 ease-out" draggable={false} height={1200} onDoubleClick={toggleGalleryZoom} ref={galleryImageRef} src={currentDetailImages[Math.min(detailImageIndex, currentDetailImages.length - 1)]} style={{ transform: `translate(${galleryOffset.x}px, ${galleryOffset.y}px) scale(${galleryScale})`, touchAction: "none" }} unoptimized width={2400} />
      </div>
      {currentDetailImages.length > 1 && <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] rounded-full bg-slate-800/75 px-4 py-2 text-sm font-semibold tabular-nums">{Math.min(detailImageIndex, currentDetailImages.length - 1) + 1} / {currentDetailImages.length}</div>}
    </div>}
  </main>;
}
