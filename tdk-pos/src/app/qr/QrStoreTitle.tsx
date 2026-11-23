"use client";
import { readJsonResponse } from "@/lib/api-response";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import QrTitleCarousel from "./QrTitleCarousel";
import { getBusinessHoursStatus, getBusinessOperatingDate, getBusinessScheduleForDate, QR_STORE_TIME_ZONE, QR_WEEKDAY_LABELS, type BusinessHours } from "@/lib/qr-business-hours";
import { buildBusinessHoursWeek, buildUpcomingBusinessHourExceptions, businessDateInSeoul } from "@/lib/qr-business-hours-display";
import type { QrPublicNotice } from "@/lib/qr-notice-model";
import type { QrPublicTitleSettings, QrTitleScreenSettings } from "@/lib/qr-title-model";
import { qrTitleHeroOverlap } from "@/lib/qr-title-model";

export type QrTitleNotice = QrPublicNotice;
type QrTitleSnapPosition = "middle" | "bottom" | "top" | "menu";
type QrTitleSnapGeometry = { rect: DOMRect; currentOffset: number; minOffset: number; maxOffset: number; upperTargetTop: number; lowerTargetTop: number };

const QR_SHEET_DRAG_THRESHOLD_PX = 96;
const QR_SHEET_DRAG_HEIGHT_RATIO = 0.22;
const QR_SHEET_CLOSE_ANIMATION_MS = 240;
const QR_SHEET_TRANSITION = "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
const QR_ORDER_TOP_SNAP_TARGET_PX = 6;

function measureQrTitleSnapGeometry(titleBox: HTMLElement, upperTargetTop: number): QrTitleSnapGeometry | null {
  const hero = document.querySelector<HTMLElement>("[data-qr-fixed-hero]");
  if (!hero) return null;
  const rect = titleBox.getBoundingClientRect();
  const heroRect = hero.getBoundingClientRect();
  const lowerTop = heroRect.height - qrTitleHeroOverlap(heroRect.width);
  const transform = window.getComputedStyle(titleBox).transform;
  const renderedOffset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
  const layoutTop = rect.top - renderedOffset;
  const minOffset = Math.min(0, upperTargetTop - layoutTop);
  const maxOffset = Math.max(0, lowerTop - layoutTop);
  return { rect, currentOffset: Math.max(minOffset, Math.min(maxOffset, renderedOffset)), minOffset, maxOffset, upperTargetTop, lowerTargetTop: lowerTop };
}

function scheduleLines(hours: BusinessHours, closedLabel: string | null) {
  if (closedLabel) return [closedLabel];
  if (hours.closed) return ["정기 휴무"];
  if (hours.allDay) return ["24시간 영업", ...(hours.breakStart && hours.breakEnd ? [`브레이크타임 ${hours.breakStart}–${hours.breakEnd}`] : [])];
  if (!hours.openTime || !hours.closeTime) return ["영업시간 미등록"];
  return [`${hours.openTime}–${hours.closeTime}`, ...(hours.breakStart && hours.breakEnd ? [`브레이크타임 ${hours.breakStart}–${hours.breakEnd}`] : [])];
}

export default function QrStoreTitle({ settings, screenSettings, previewMode = false, previewTableNo, photoHeightPx, photoViewportHeightPx, fixedHero = false, snapEnabled = false, notices = [], menuOrderHeader = false, tableOrderMode = false, orderHistoryHeader = false, onShareTableQr }: { settings: QrPublicTitleSettings; screenSettings?: QrTitleScreenSettings; previewMode?: boolean; previewTableNo?: string; photoHeightPx?: number; photoViewportHeightPx?: number; fixedHero?: boolean; snapEnabled?: boolean; notices?: readonly QrTitleNotice[]; menuOrderHeader?: boolean; tableOrderMode?: boolean; orderHistoryHeader?: boolean; onShareTableQr?: () => void }) {
  const [nowMs, setNowMs] = useState(() => Date.parse(settings.serverNow));
  const [tableNo, setTableNo] = useState<string | null>(previewMode ? previewTableNo ?? null : null);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const hoursHistoryRef = useRef(false);
  const hoursBackPendingRef = useRef(false);
  const hoursDragRef = useRef<{ pointerId: number; startY: number } | null>(null);
  const hoursSheetRef = useRef<HTMLElement>(null);
  const hoursCloseTimerRef = useRef<number | null>(null);
  const [hoursDragOffset, setHoursDragOffset] = useState(0);
  const [hoursDragging, setHoursDragging] = useState(false);
  const hoursClosingRef = useRef(false);
  const [selectedNotice, setSelectedNotice] = useState<QrTitleNotice | null>(null);
  const selectedNoticeRef = useRef<QrTitleNotice | null>(null);
  const noticeHistoryRef = useRef(false);
  const noticeBackPendingRef = useRef(false);
  const queuedNoticeRef = useRef<QrTitleNotice | null>(null);
  const noticeDragRef = useRef<{ pointerId: number; startY: number } | null>(null);
  const noticeSheetRef = useRef<HTMLElement>(null);
  const noticeCloseTimerRef = useRef<number | null>(null);
  const [noticeDragOffset, setNoticeDragOffset] = useState(0);
  const [noticeDragging, setNoticeDragging] = useState(false);
  const noticeClosingRef = useRef(false);
  const [showAssistantToast, setShowAssistantToast] = useState(false);
  const assistantToastTimer = useRef<number | null>(null);
  const titleSnapOffsetRef = useRef(0);
  const titleSnapDragRef = useRef<{ pointerId: number; startY: number; startOffset: number; startSnapPosition: QrTitleSnapPosition; minOffset: number; maxOffset: number; menuScrollTarget: number | null; startScrollY: number; startedAt: number; crossedTop: boolean } | null>(null);
  const menuScrollTargetRef = useRef<number | null>(null);
  const topScrollTargetRef = useRef<number | null>(null);
  const topSnapOffsetRef = useRef<number>(0);
  const bottomSnapOffsetRef = useRef<number>(0);
  const touchScrollYRef = useRef<number | null>(null);
  const userScrollIntentRef = useRef<{ direction: "menu" | "top"; at: number } | null>(null);
  const [titleSnapOffset, setTitleSnapOffset] = useState(0);
  const [titleSnapPosition, setTitleSnapPosition] = useState<QrTitleSnapPosition>("middle");
  const [titleSnapDragging, setTitleSnapDragging] = useState(false);
  const setTitleSnap = (offset: number, minOffset: number, maxOffset: number) => {
    const safeMin = Math.min(0, minOffset);
    const safeMax = Math.max(0, maxOffset);
    const safeOffset = Math.max(safeMin, Math.min(safeMax, offset));
    titleSnapOffsetRef.current = safeOffset;
    setTitleSnapOffset(safeOffset);
  };
  const startTitleSnapDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!snapEnabled || !fixedHero || !settings.photos.length || (event.pointerType === "mouse" && event.button !== 0) ||
      (event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    const titleBox = event.currentTarget;
    const geometry = measureQrTitleSnapGeometry(titleBox, tableOrderMode ? QR_ORDER_TOP_SNAP_TARGET_PX : 0);
    if (!geometry) return;
    const { rect, currentOffset, minOffset, maxOffset, lowerTargetTop } = geometry;
    if (rect.top < -32 || rect.top > lowerTargetTop + 32) return;
    const snapStops: { position: QrTitleSnapPosition; offset: number }[] = [
      { position: "top", offset: minOffset },
      { position: "middle", offset: 0 },
      { position: "bottom", offset: maxOffset },
    ];
    const startSnapPosition = snapStops.reduce((closest, candidate) =>
      Math.abs(candidate.offset - currentOffset) < Math.abs(closest.offset - currentOffset) ? candidate : closest,
      snapStops[1]);
    titleSnapOffsetRef.current = currentOffset;
    setTitleSnapOffset(currentOffset);
    const categoryHeader = document.querySelector<HTMLElement>("[data-qr-header]");
    const menuScrollTarget = categoryHeader
      ? Math.max(0, window.scrollY + categoryHeader.getBoundingClientRect().top)
      : null;
    titleSnapDragRef.current = { pointerId: event.pointerId, startY: event.clientY,
      startOffset: currentOffset, startSnapPosition: startSnapPosition.position, minOffset, maxOffset,
      menuScrollTarget, startScrollY: window.scrollY, startedAt: performance.now(), crossedTop: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
    setTitleSnapDragging(true);
  };
  const moveTitleSnapDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = titleSnapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const requestedOffset = drag.startOffset + event.clientY - drag.startY;
    // Keep a gesture adjacent to its starting stop. A long pull from bottom
    // must settle at middle before a separate gesture can reach top; likewise
    // a downward pull from top must pass through middle before bottom.
    if ((drag.startSnapPosition === "bottom" && requestedOffset < 0) ||
      (drag.startSnapPosition === "top" && requestedOffset > 0)) {
      setTitleSnap(0, drag.minOffset, drag.maxOffset);
      return;
    }
    if (requestedOffset < drag.minOffset) {
      setTitleSnap(drag.minOffset, drag.minOffset, drag.maxOffset);
      drag.crossedTop = true;
      return;
    }
    if (requestedOffset > drag.minOffset) drag.crossedTop = false;
    setTitleSnap(requestedOffset, drag.minOffset, drag.maxOffset);
  };
  const finishTitleSnapDrag = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const drag = titleSnapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    titleSnapDragRef.current = null;
    const delta = event.clientY - drag.startY;
    const velocity = delta / Math.max(1, performance.now() - drag.startedAt);
    const currentOffset = titleSnapOffsetRef.current;
    let targetPosition: QrTitleSnapPosition = "middle";
    if (cancelled) {
      const candidates: { position: QrTitleSnapPosition; offset: number }[] = [
        { position: "top", offset: drag.minOffset },
        { position: "middle", offset: 0 },
        { position: "bottom", offset: drag.maxOffset },
      ];
      targetPosition = candidates.reduce((closest, candidate) =>
        Math.abs(candidate.offset - currentOffset) < Math.abs(closest.offset - currentOffset) ? candidate : closest,
        candidates[1]).position;
    } else if (drag.crossedTop) {
      targetPosition = drag.startSnapPosition === "top" && drag.menuScrollTarget !== null &&
        (delta <= -28 || velocity <= -0.35) ? "menu" : "top";
    } else if (drag.startSnapPosition === "bottom") {
      targetPosition = delta <= -24 || velocity <= -0.35 ? "middle" : "bottom";
    } else if (drag.startSnapPosition === "top") {
      targetPosition = delta >= 24 || velocity >= 0.35 ? "middle" : "top";
    } else if (delta >= 28 || velocity >= 0.35) {
      targetPosition = "bottom";
    } else if (delta <= -28 || velocity <= -0.35) {
      targetPosition = "top";
    }
    const targetOffset = targetPosition === "top" || targetPosition === "menu" ? drag.minOffset : targetPosition === "bottom" ? drag.maxOffset : 0;
    setTitleSnapPosition(targetPosition);
    setTitleSnap(targetOffset, drag.minOffset, drag.maxOffset);
    setTitleSnapDragging(false);
    if (targetPosition === "top" || targetPosition === "menu") {
      const titleBox = document.querySelector<HTMLElement>('[data-qr-menu-background-anchor="title"]');
      const geometry = titleBox ? measureQrTitleSnapGeometry(titleBox, tableOrderMode ? QR_ORDER_TOP_SNAP_TARGET_PX : 0) : null;
      const settledMenuScrollTarget = drag.menuScrollTarget === null
        ? null
        : Math.max(0, drag.menuScrollTarget + targetOffset - drag.startOffset);
      topScrollTargetRef.current = geometry
        ? Math.max(0, window.scrollY + geometry.rect.top + (drag.minOffset - geometry.currentOffset) - geometry.upperTargetTop)
        : drag.startScrollY;
      topSnapOffsetRef.current = drag.minOffset;
      bottomSnapOffsetRef.current = drag.maxOffset;
      menuScrollTargetRef.current = settledMenuScrollTarget;
    } else {
      menuScrollTargetRef.current = null;
      topScrollTargetRef.current = null;
    }
    if (targetPosition === "menu" && drag.menuScrollTarget !== null) {
      const target = menuScrollTargetRef.current ?? drag.menuScrollTarget;
      window.scrollTo({ top: target, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    event.stopPropagation();
  };
  useEffect(() => () => {
    titleSnapDragRef.current = null;
    titleSnapOffsetRef.current = 0;
    menuScrollTargetRef.current = null;
    topScrollTargetRef.current = null;
    topSnapOffsetRef.current = 0;
    bottomSnapOffsetRef.current = 0;
  }, []);
  useEffect(() => {
    if (!snapEnabled || !fixedHero || (titleSnapPosition !== "top" && titleSnapPosition !== "menu")) return;
    const onScroll = () => {
      const menuTarget = menuScrollTargetRef.current;
      const topTarget = topScrollTargetRef.current;
      if (menuTarget === null || topTarget === null) return;
      const intent = userScrollIntentRef.current;
      if (!intent || Date.now() - intent.at > 1500) return;
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
      if (titleSnapPosition === "top" && intent.direction === "menu" && window.scrollY >= menuTarget - 1) {
        userScrollIntentRef.current = null;
        setTitleSnapPosition("menu");
        if (Math.abs(window.scrollY - menuTarget) > 1) window.scrollTo({ top: menuTarget, behavior });
      } else if (titleSnapPosition === "menu" && intent.direction === "top" && window.scrollY < menuTarget - 12) {
        userScrollIntentRef.current = null;
        menuScrollTargetRef.current = null;
        setTitleSnapPosition("top");
        const minOffset = topSnapOffsetRef.current;
        titleSnapOffsetRef.current = minOffset;
        setTitleSnapOffset(minOffset);
        window.scrollTo({ top: topTarget, behavior });
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 1) return;
      userScrollIntentRef.current = { direction: event.deltaY > 0 ? "menu" : "top", at: Date.now() };
    };
    const onTouchStart = (event: TouchEvent) => {
      touchScrollYRef.current = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      const previousY = touchScrollYRef.current;
      if (nextY === undefined || previousY === null) return;
      const deltaY = nextY - previousY;
      if (Math.abs(deltaY) >= 3) {
        userScrollIntentRef.current = { direction: deltaY < 0 ? "menu" : "top", at: Date.now() };
        touchScrollYRef.current = nextY;
      }
    };
    const onTouchEnd = () => { touchScrollYRef.current = null; };
    const onCategoryPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("[data-qr-header]")) userScrollIntentRef.current = null;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("pointerdown", onCategoryPointerDown, true);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("pointerdown", onCategoryPointerDown, true);
    };
  }, [fixedHero, snapEnabled, tableOrderMode, titleSnapPosition]);
  useEffect(() => {
    if (previewMode || !(tableOrderMode || screenSettings?.rightMode === "TABLE_NO")) return;
    const controller = new AbortController();
    void fetch("/api/qr/table-orders", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async response => response.ok ? await readJsonResponse(response, response.url, "API request") as { success?: boolean; tableNo?: string } : null)
      .then(payload => { if (payload?.success && payload.tableNo) setTableNo(payload.tableNo); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [previewMode, screenSettings?.rightMode, tableOrderMode]);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => {
    if (assistantToastTimer.current !== null) window.clearTimeout(assistantToastTimer.current);
  }, []);
  const resetNoticeDrag = useCallback(() => {
    if (noticeCloseTimerRef.current !== null) window.clearTimeout(noticeCloseTimerRef.current);
    noticeCloseTimerRef.current = null;
    noticeDragRef.current = null;
    noticeClosingRef.current = false;
    setNoticeDragOffset(0);
    setNoticeDragging(false);
  }, []);
  const openNotice = useCallback((notice: QrTitleNotice) => {
    if (noticeBackPendingRef.current) {
      queuedNoticeRef.current = notice;
      return;
    }
    if (selectedNoticeRef.current) return;
    selectedNoticeRef.current = notice;
    setSelectedNotice(notice);
    window.history.pushState({ ...(window.history.state ?? {}), tdkQrNoticeSheet: notice.id }, "", window.location.href);
    noticeHistoryRef.current = true;
  }, []);
  const closeNotice = useCallback(() => {
    if (!selectedNoticeRef.current) return;
    selectedNoticeRef.current = null;
    setSelectedNotice(null);
    resetNoticeDrag();
    if (noticeHistoryRef.current) {
      noticeHistoryRef.current = false;
      noticeBackPendingRef.current = true;
      window.history.back();
    }
  }, [resetNoticeDrag]);
  const closeNoticeWithAnimation = () => {
    if (!selectedNoticeRef.current || noticeClosingRef.current) return;
    noticeClosingRef.current = true;
    setNoticeDragging(false);
    const sheetHeight = noticeSheetRef.current?.getBoundingClientRect().height ?? 0;
    setNoticeDragOffset(Math.max(window.innerHeight, sheetHeight + 40));
    if (noticeCloseTimerRef.current !== null) window.clearTimeout(noticeCloseTimerRef.current);
    noticeCloseTimerRef.current = window.setTimeout(() => {
      noticeCloseTimerRef.current = null;
      if (noticeClosingRef.current) closeNotice();
    }, QR_SHEET_CLOSE_ANIMATION_MS);
  };
  const resetHoursDrag = useCallback(() => {
    if (hoursCloseTimerRef.current !== null) window.clearTimeout(hoursCloseTimerRef.current);
    hoursCloseTimerRef.current = null;
    hoursDragRef.current = null;
    hoursClosingRef.current = false;
    setHoursDragOffset(0);
    setHoursDragging(false);
  }, []);
  const openBusinessHours = useCallback(() => {
    if (hoursBackPendingRef.current) return;
    if (openRef.current) return;
    openRef.current = true;
    setOpen(true);
    window.history.pushState({ ...(window.history.state ?? {}), tdkQrBusinessHoursSheet: true }, "", window.location.href);
    hoursHistoryRef.current = true;
  }, []);
  const closeBusinessHours = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    resetHoursDrag();
    if (hoursHistoryRef.current) {
      hoursHistoryRef.current = false;
      hoursBackPendingRef.current = true;
      window.history.back();
    }
  }, [resetHoursDrag]);
  const closeBusinessHoursWithAnimation = () => {
    if (!openRef.current || hoursClosingRef.current) return;
    hoursClosingRef.current = true;
    setHoursDragging(false);
    const sheetHeight = hoursSheetRef.current?.getBoundingClientRect().height ?? 0;
    setHoursDragOffset(Math.max(window.innerHeight, sheetHeight + 40));
    if (hoursCloseTimerRef.current !== null) window.clearTimeout(hoursCloseTimerRef.current);
    hoursCloseTimerRef.current = window.setTimeout(() => {
      hoursCloseTimerRef.current = null;
      if (hoursClosingRef.current) closeBusinessHours();
    }, QR_SHEET_CLOSE_ANIMATION_MS);
  };
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (noticeBackPendingRef.current) {
        noticeBackPendingRef.current = false;
        const queued = queuedNoticeRef.current;
        queuedNoticeRef.current = null;
        if (queued) openNotice(queued);
        return;
      }
      if (!noticeHistoryRef.current || event.state?.tdkQrNoticeSheet) return;
      noticeHistoryRef.current = false;
      selectedNoticeRef.current = null;
      setSelectedNotice(null);
      resetNoticeDrag();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openNotice, resetNoticeDrag]);
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (hoursBackPendingRef.current) {
        hoursBackPendingRef.current = false;
        return;
      }
      if (!hoursHistoryRef.current || event.state?.tdkQrBusinessHoursSheet) return;
      hoursHistoryRef.current = false;
      openRef.current = false;
      setOpen(false);
      resetHoursDrag();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [resetHoursDrag]);
  useEffect(() => () => {
    if (noticeCloseTimerRef.current !== null) window.clearTimeout(noticeCloseTimerRef.current);
  }, []);
  useEffect(() => () => {
    if (hoursCloseTimerRef.current !== null) window.clearTimeout(hoursCloseTimerRef.current);
  }, []);
  const startNoticeDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    if (noticeClosingRef.current) return;
    noticeDragRef.current = { pointerId: event.pointerId, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setNoticeDragging(true);
  };
  const moveNoticeDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = noticeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setNoticeDragOffset(Math.max(0, event.clientY - drag.startY));
  };
  const finishNoticeDrag = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const drag = noticeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    noticeDragRef.current = null;
    const distance = Math.max(0, event.clientY - drag.startY);
    const sheetHeight = noticeSheetRef.current?.getBoundingClientRect().height ?? 0;
    if (!cancelled && distance >= Math.max(QR_SHEET_DRAG_THRESHOLD_PX, sheetHeight * QR_SHEET_DRAG_HEIGHT_RATIO)) {
      noticeClosingRef.current = true;
      setNoticeDragging(false);
      setNoticeDragOffset(Math.max(window.innerHeight, sheetHeight + 40));
      noticeCloseTimerRef.current = window.setTimeout(() => {
        noticeCloseTimerRef.current = null;
        if (noticeClosingRef.current) closeNotice();
      }, QR_SHEET_CLOSE_ANIMATION_MS);
      return;
    }
    setNoticeDragging(false);
    setNoticeDragOffset(0);
  };
  const startHoursDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.stopPropagation();
    if (hoursClosingRef.current) return;
    hoursDragRef.current = { pointerId: event.pointerId, startY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setHoursDragging(true);
  };
  const moveHoursDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = hoursDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    setHoursDragOffset(Math.max(0, event.clientY - drag.startY));
  };
  const finishHoursDrag = (event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
    const drag = hoursDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    hoursDragRef.current = null;
    const distance = Math.max(0, event.clientY - drag.startY);
    const sheetHeight = hoursSheetRef.current?.getBoundingClientRect().height ?? 0;
    if (!cancelled && distance >= Math.max(QR_SHEET_DRAG_THRESHOLD_PX, sheetHeight * QR_SHEET_DRAG_HEIGHT_RATIO)) {
      hoursClosingRef.current = true;
      setHoursDragging(false);
      setHoursDragOffset(Math.max(window.innerHeight, sheetHeight + 40));
      hoursCloseTimerRef.current = window.setTimeout(() => {
        hoursCloseTimerRef.current = null;
        if (hoursClosingRef.current) closeBusinessHours();
      }, QR_SHEET_CLOSE_ANIMATION_MS);
      return;
    }
    setHoursDragging(false);
    setHoursDragOffset(0);
  };
  useEffect(() => {
    if (!open && !selectedNotice) return;
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
  }, [open, selectedNotice]);

  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const status = useMemo(() => getBusinessHoursStatus(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules, settings.todayOverride), [settings.weekly, settings.specialHours, settings.closedDates, settings.holidayRules, settings.todayOverride, now]);
  const todayDate = businessDateInSeoul(now);
  const operatingDate = getBusinessOperatingDate(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules);
  const todayOverride = settings.todayOverride?.businessDate === operatingDate ? settings.todayOverride : null;
  const todayOverrideNotes = [
    todayOverride?.earlyClose?.mode === "NOW" ? "오늘 영업을 즉시 마감하도록 설정했습니다." : todayOverride?.earlyClose?.mode === "AT" ? `오늘 조기 마감 · ${todayOverride.earlyClose.closeTime}` : "",
    todayOverride?.earlyBreak ? `오늘 브레이크타임 · ${todayOverride.earlyBreak.startTime}–${todayOverride.earlyBreak.endTime}` : "",
  ].filter(Boolean);
  const weekRows = useMemo(() => buildBusinessHoursWeek(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules, settings.kasiHolidays, settings.todayOverride, getBusinessScheduleForDate), [settings.weekly, settings.specialHours, settings.closedDates, settings.holidayRules, settings.kasiHolidays, settings.todayOverride, now]);
  const upcomingExceptions = useMemo(() => buildUpcomingBusinessHourExceptions(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules, settings.kasiHolidays, settings.todayOverride, getBusinessScheduleForDate), [settings.weekly, settings.specialHours, settings.closedDates, settings.holidayRules, settings.kasiHolidays, settings.todayOverride, now]);
  const hasFutureSpecial = settings.specialHours.some(item => item.date >= todayDate);
  const hasBox = Boolean(screenSettings) || menuOrderHeader || Boolean(settings.storeName.trim()) || settings.weekly.some(item => item.closed || item.openTime || item.closeTime) || hasFutureSpecial;
  const compactScreenHeader = tableOrderMode || Boolean(screenSettings);
  const showAssistantPreparingToast = () => {
    setShowAssistantToast(true);
    if (assistantToastTimer.current !== null) window.clearTimeout(assistantToastTimer.current);
    assistantToastTimer.current = window.setTimeout(() => {
      setShowAssistantToast(false);
      assistantToastTimer.current = null;
    }, 2200);
  };

  const weekDateLabel = (date: string) => `${QR_WEEKDAY_LABELS[new Date(`${date}T00:00:00.000Z`).getUTCDay()]} ${date.slice(5, 7)}/${date.slice(8, 10)}`;
  const exceptionDateLabel = (date: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: QR_STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(`${date}T12:00:00+09:00`));

  return <>
    <div className={orderHistoryHeader ? "contents" : "w-full"} data-qr-title-stack>
      {settings.photos.length > 0 && !fixedHero && <QrTitleCarousel key={settings.photos.map(photo => photo.id).join("|")} photos={settings.photos} photoHeightPx={photoHeightPx} viewportHeightPx={photoViewportHeightPx} />}
      {hasBox && <section className={`relative z-10 mx-auto w-[92%] max-w-2xl rounded-2xl bg-white text-center shadow-[0_4px_16px_rgba(0,0,0,0.12)] ${fixedHero && settings.photos.length || photoViewportHeightPx !== undefined ? "mt-0" : settings.photos.length ? "-mt-9" : "mt-4"}`} data-qr-menu-background-anchor="title" data-qr-title-snap-offset={snapEnabled ? titleSnapOffset : undefined} data-qr-title-snap-position={snapEnabled ? titleSnapPosition : undefined} onPointerCancel={snapEnabled ? event => finishTitleSnapDrag(event, true) : undefined} onPointerDown={snapEnabled ? startTitleSnapDrag : undefined} onPointerMove={snapEnabled ? moveTitleSnapDrag : undefined} onPointerUp={snapEnabled ? event => finishTitleSnapDrag(event) : undefined} style={snapEnabled ? { transform: `translateY(${titleSnapOffset}px)`, marginBottom: titleSnapOffset, transition: titleSnapDragging ? "none" : "transform 300ms cubic-bezier(0.22, 1, 0.36, 1), margin-bottom 300ms cubic-bezier(0.22, 1, 0.36, 1)", touchAction: "none" } : undefined}>
        <div className={`px-3 ${compactScreenHeader ? "py-0.5" : "py-1"}`}>
          {screenSettings
            ? <div className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 ${compactScreenHeader ? "py-0.5" : "py-1"}`}>
                {screenSettings.leftMode === "SHARE_QR"
                  ? <button aria-label="함께 주문 QR 공유" className="flex min-h-8 min-w-0 items-center justify-start gap-1 rounded-lg text-left text-[clamp(0.55rem,2.7vw,0.7rem)] font-semibold leading-tight text-[#1769D2] disabled:cursor-default" disabled={previewMode || !onShareTableQr} onClick={event => { event.stopPropagation(); onShareTableQr?.(); }} onPointerDown={event => { if (snapEnabled) event.stopPropagation(); }} type="button">
                      <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14v2m2 2v3h-3m-4 0h2" /></svg>
                      <span className="min-w-0 truncate">함께 주문 QR</span>
                    </button>
                  : screenSettings.leftMode === "TEXT"
                    ? <span className="min-w-0 truncate text-left text-[clamp(0.55rem,2.7vw,0.7rem)] font-medium leading-tight text-slate-900">{screenSettings.leftText}</span>
                    : <span aria-hidden="true" />}
                <h2 className="min-h-8 min-w-0 break-words px-1 text-center text-[clamp(1.375rem,6vw,1.75rem)] font-extrabold leading-tight text-slate-900">{screenSettings.title}</h2>
                {screenSettings.rightMode === "TABLE_NO"
                  ? tableNo ? <span aria-label={`테이블 No.${tableNo}`} className="min-w-0 truncate text-right text-[clamp(0.55rem,2.7vw,0.7rem)] font-normal leading-tight text-[#1F2937]">No.{tableNo}</span> : <span aria-hidden="true" />
                  : screenSettings.rightMode === "TEXT"
                    ? <span className="min-w-0 truncate text-right text-[clamp(0.55rem,2.7vw,0.7rem)] font-normal leading-tight text-[#1F2937]">{screenSettings.rightText}</span>
                    : <span aria-hidden="true" />}
              </div>
            : orderHistoryHeader
            ? <h2 className="py-1 text-center text-lg font-extrabold leading-tight text-slate-900">{settings.storeName.trim() || "탑동김치찌개"}</h2>
            : menuOrderHeader
            ? <div className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 ${tableOrderMode ? "py-0.5" : "py-1"}`}>
                {tableOrderMode && tableNo
                  ? <button aria-label="함께 주문 QR 공유" className="flex min-h-8 min-w-0 items-center justify-start gap-1 rounded-lg text-left text-[clamp(0.55rem,2.7vw,0.7rem)] font-semibold leading-tight text-[#1769D2]" onClick={event => { event.stopPropagation(); onShareTableQr?.(); }} onPointerDown={event => event.stopPropagation()} type="button">
                      <svg aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14v2m2 2v3h-3m-4 0h2" /></svg>
                      <span className="min-w-0 truncate">함께 주문 QR</span>
                    </button>
                  : <span className="min-w-0 truncate text-left text-[10px] font-medium leading-tight text-slate-900">탑동김치찌개</span>}
                <h2 className="whitespace-nowrap px-1 text-center text-[clamp(1.375rem,6vw,1.75rem)] font-extrabold leading-tight text-slate-900">주문하기</h2>
                {tableOrderMode && tableNo
                  ? <span aria-label={`테이블 No.${tableNo}`} className="min-w-0 truncate text-right text-[clamp(0.55rem,2.7vw,0.7rem)] font-normal leading-tight text-[#1F2937]">No.{tableNo}</span>
                  : <span aria-hidden="true" />}
              </div>
            : <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start">
                {settings.subtitle.trim() ? <p className="min-w-0 truncate text-left text-[10px] font-medium leading-3 text-slate-500">{settings.subtitle.trim()}</p> : <span aria-hidden="true" />}
                {settings.storeName.trim() ? <h2 className="min-w-0 break-words text-center text-[clamp(1.25rem,5.5vw,1.375rem)] font-extrabold leading-tight text-slate-900">{settings.storeName.trim()}</h2> : <span aria-hidden="true" />}
                <span aria-hidden="true" />
              </div>}
          <div className="mt-0.5 flex min-h-7 max-w-full items-center justify-center">
            {!screenSettings || screenSettings.footerMode === "BUSINESS_HOURS"
            ? <button aria-haspopup="dialog" className={`flex min-h-7 max-w-full items-center justify-center gap-1.5 text-xs font-medium ${status.state === "OPEN" ? "text-emerald-700" : status.state === "BREAK" ? "text-amber-700" : "text-slate-600"}`} onClick={openBusinessHours} type="button">
                <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                <span className="min-w-0 truncate text-[clamp(0.5625rem,2.8vw,0.75rem)]">{status.message}</span><svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            : screenSettings.footerMode === "TEXT"
              ? <p className="max-w-full truncate text-[clamp(0.5625rem,2.8vw,0.75rem)] font-medium leading-tight text-slate-700">{screenSettings.footerText}</p>
              : null}
          </div>
        </div>
      </section>}
      {!orderHistoryHeader && notices.length > 0 && <section aria-label="매장 안내" className="relative z-10 mx-auto w-full max-w-2xl bg-transparent py-1">
        {notices.map(notice => <button className="flex min-h-10 w-full items-center justify-center px-3 py-1 text-center text-[17px] font-semibold text-slate-700" key={notice.id} onClick={() => openNotice(notice)} type="button">
          <span className="inline-flex min-w-0 max-w-full items-center justify-center gap-1.5"><span className="break-words">{notice.title}</span><svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg></span>
        </button>)}
      </section>}
      {!orderHistoryHeader && <section aria-label="AI 메뉴도우미" className="relative z-10 mx-auto w-full max-w-2xl border-b border-slate-200 bg-transparent py-1">
        <button className="flex min-h-10 w-full items-center justify-center px-3 py-1 text-center text-[17px] font-semibold text-slate-700" onClick={showAssistantPreparingToast} type="button">
          <span className="inline-flex min-w-0 max-w-full items-center justify-center gap-1.5">
            <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-600" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 3v2m-7 4h14v9H5zM9 12h.01M15 12h.01M9 16h6M5 9 3.5 7.5M19 9l1.5-1.5" /></svg>
            <span>AI 메뉴도우미</span>
            <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          </span>
        </button>
      </section>}
      {!orderHistoryHeader && showAssistantToast && <div aria-live="polite" className="pointer-events-none fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-1/2 z-[80] -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-lg">AI 메뉴도우미 준비 중입니다.</div>}
    </div>

    {open && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" onClick={closeBusinessHours}>
      <section aria-label="영업시간 안내" aria-modal="true" className="flex max-h-[min(84dvh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} ref={hoursSheetRef} role="dialog" style={{ transform: `translateY(${hoursDragOffset}px)`, transition: hoursDragging ? "none" : QR_SHEET_TRANSITION }}>
        <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-100 px-5" onPointerCancel={event => finishHoursDrag(event, true)} onPointerDown={startHoursDrag} onPointerMove={moveHoursDrag} onPointerUp={event => finishHoursDrag(event)} style={{ touchAction: "none" }}>
          <h2 className="text-lg font-extrabold text-slate-900">영업시간 안내</h2>
          <button aria-label="영업시간 안내 닫기" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700" onClick={closeBusinessHoursWithAnimation} type="button"><svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="space-y-1.5 rounded-xl bg-slate-50 px-4 py-3"><p className="text-sm font-bold text-slate-900">{status.message}</p>{status.state === "OPEN" && <p className="text-xs text-slate-500">※ 재료 소진 시 조기 마감될 수 있습니다.</p>}
          </div>
          {todayOverrideNotes.length > 0 && <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">{todayOverrideNotes.map(note => <p key={note}>{note}</p>)}</div>}
          <div className="mb-2 mt-5"><h3 className="font-bold text-slate-900">기본 영업시간</h3><p className="mt-1 text-xs text-slate-500">라스트오더는 영업 종료 30분 전입니다.</p></div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {weekRows.map(row => <li aria-current={row.isToday ? "date" : undefined} className={`grid grid-cols-[minmax(0,1fr)_42%] items-start gap-3 px-4 py-3 text-sm ${row.isToday ? "bg-blue-50 font-semibold text-blue-900" : "text-slate-700"}`} key={row.date}>
              <div className="min-w-0"><p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5"><span>{weekDateLabel(row.date)}</span>{row.isToday && <span className="text-xs text-blue-700">· 오늘</span>}</p>{row.notes.length > 0 && <p className="mt-0.5 break-keep text-xs font-medium text-slate-500">{row.notes.join(" · ")}</p>}</div>
              <div className="min-w-0 space-y-0.5 break-keep text-right">{scheduleLines(row.hours, row.closedLabel).map((line, index) => <p className={index === 1 ? "text-xs font-medium" : ""} key={`${index}-${line}`}>{line}</p>)}</div>
            </li>)}
          </ul>
          {upcomingExceptions.length > 0 && <><h3 className="mb-2 mt-5 font-bold text-slate-900">날짜별 운영 예외</h3><ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {upcomingExceptions.map(row => <li className="grid grid-cols-[minmax(0,1fr)_42%] items-start gap-3 px-4 py-3 text-sm text-slate-700" key={row.date}><div className="min-w-0"><p>{exceptionDateLabel(row.date)}</p>{row.notes.length > 0 && <p className="mt-0.5 break-keep text-xs font-medium text-slate-500">{row.notes.join(" · ")}</p>}</div><div className="min-w-0 space-y-0.5 break-keep text-right">{scheduleLines(row.hours, row.closedLabel).map((line, index) => <p className={index === 1 ? "text-xs font-medium" : ""} key={`${index}-${line}`}>{line}</p>)}</div></li>)}
          </ul></>}
        </div>
      </section>
    </div>}
    {selectedNotice && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" onClick={closeNotice}>
      <section aria-label={selectedNotice.title} aria-modal="true" className="flex max-h-[min(84dvh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} ref={noticeSheetRef} role="dialog" style={{ transform: `translateY(${noticeDragOffset}px)`, transition: noticeDragging ? "none" : QR_SHEET_TRANSITION }}>
        <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-100 px-5" onPointerCancel={event => finishNoticeDrag(event, true)} onPointerDown={startNoticeDrag} onPointerMove={moveNoticeDrag} onPointerUp={event => finishNoticeDrag(event)} style={{ touchAction: "none" }}>
          <div className="min-w-0 py-2"><h2 className="break-words text-lg font-extrabold text-slate-900">{selectedNotice.title}</h2>{settings.storeName.trim() && <p className="mt-1 text-sm text-slate-500">{settings.storeName.trim()}</p>}</div>
          <button aria-label="안내문 닫기" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700" onClick={closeNoticeWithAnimation} type="button"><svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="space-y-4">{selectedNotice.blocks.map(block => block.type === "image"
            ? <Image alt="안내문 이미지" className="block h-auto max-w-full rounded-xl" height={1200} key={block.id} loading="lazy" src={block.imageUrl} unoptimized width={1200} />
            : <p className={`${block.style === "heading" ? "text-[18px] font-bold" : "text-[17px] leading-6"} ${block.bold ? "font-bold" : ""} ${block.highlight ? "rounded bg-amber-100 px-1" : ""} ${block.style === "bullet" ? "before:mr-2 before:content-['•']" : ""} whitespace-pre-wrap break-words text-slate-700`} key={block.id}>{block.text}</p>)}</div>
        </div>
      </section>
    </div>}
  </>;
}
