"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import QRCode from "qrcode";
import QrStoreTitle from "@/app/qr/QrStoreTitle";
import QrTitleCarousel from "@/app/qr/QrTitleCarousel";
import { buildUnifiedQrOrderRounds } from "@/lib/qr-unified-order-rounds";
import { accumulateQrPanelWheelIntent, type QrPanelWheelIntent } from "@/lib/qr-order-panel-wheel";
import { getQrCookingProgress, type QrCookingProgress } from "@/lib/qr-cooking-progress";
import type { QrPublicTitleSettings } from "@/lib/qr-title-model";
import type { QrPublicNotice } from "@/lib/qr-notice-model";

type OrderItem = {
  qrOrderId: number;
  qrOrderItemId: number;
  menuId: number;
  itemName: string;
  qty: number;
  unitPrice: string;
  totalAmount: string;
  options: Array<{ optionName: string; qty: number; totalAmount: string }>;
  kdsKind: string;
  stage: "WAITING" | "COOKING" | "DONE" | null;
  kdsStartedAtMs: number | null;
  kdsCompletedAtMs: number | null;
  postCookTimerEligible: boolean;
  postCookTimerMinutes: number | null;
  postCookTimerStartedAtMs: number | null;
  showCookingProgress: boolean;
};
type QrOrder = {
  qrOrderId: number;
  status: string;
  totalAmount: string;
  orderedAt: string;
  acceptedOrderId: number | null;
  acceptedAt: string | null;
  note: string | null;
};
type PosOrder = { orderId: number; acceptedQrOrderId: number | null; status: string; totalAmount: string; orderedAt: string };
type PosOrderItem = { orderId: number; orderItemId: number; parentOrderItemId: number | null; menuId: number; itemType: "NORMAL" | "COMPONENT" | "SERVICE";
  status: string; itemName: string; qty: number; originalQty: number; effectiveQty: number; cancelledQty: number; unitPrice: string; totalAmount: string;
  effectiveTotalAmount: string; kdsKind: string; stage: "WAITING" | "COOKING" | "DONE" | null; postCookTimerEligible: boolean;
  postCookTimerMinutes: number | null; postCookTimerStartedAtMs: number | null; showCookingProgress: boolean;
  options: Array<{ modifierOptionId: number | null; optionName: string; qty: number; unitPrice: string; independentQty: boolean }> };
type ConfirmedSummaryItem = { menuId: string; itemName: string; qty: number; totalAmount: number; optionLabel: string; itemType: string;
  components: Array<{ itemName: string; qty: number; totalAmount: number }> };
type Payload = {
  success?: boolean;
  code?: string;
  accessState?: "PAYMENT_COMPLETED";
  tableNo?: string;
  totalPersonCount?: number | null;
  serverNow?: number;
  canViewOrders?: boolean;
  needsJoin?: boolean;
  orders?: QrOrder[];
  items?: OrderItem[];
  posOrders?: PosOrder[];
  posItems?: PosOrderItem[];
  confirmedSummary?: { items: ConfirmedSummaryItem[]; grossAmount: number; discountAmount: number; prepaidAmount: number; totalAmount: number; receivableAmount: number };
  message?: string;
};
type Invite = { url: string; qrData: string; expiresAt: string };
type PanelSnapIndex = 0 | 1 | 2;
type PanelDrag = { pointerId: number; startY: number; lastY: number; startOffset: number; startSnapIndex: PanelSnapIndex; startedAt: number; moved: boolean };
type PanelGeometry = { baseTop: number; offsets: [number, number, number] };
const emptyOrders: QrOrder[] = [];
const emptyItems: OrderItem[] = [];
const emptyPosOrders: PosOrder[] = [];
const emptyPosItems: PosOrderItem[] = [];
const won = (amount: string | number) => `${new Intl.NumberFormat("ko-KR").format(Math.round(Number(amount) || 0))}원`;
const dateTime = (value: string) => new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
const orderTime = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(value));
function QrCookingProgressLine({ progress }: { progress: QrCookingProgress }) {
  const labels = ["대기중", "조리중", "조리완료", progress.tableBoilLabel, "완료"];
  const columns = "0.9fr 0.9fr 1.05fr 1.65fr 0.75fr";
  return <div aria-label={`조리 진행 상태: ${labels[progress.currentStep - 1]}`} className="mt-2 grid min-w-0 gap-x-1" role="status" style={{ gridTemplateColumns: columns }}>
    {labels.map((label, index) => {
      const step = index + 1;
      const current = step === progress.currentStep;
      const past = step < progress.currentStep;
      const isWaiting = step === 1;
      const isBoil = step === 4;
      const colorClass = current ? "text-blue-700" : isWaiting && !past ? "text-slate-300" : past ? "text-slate-500" : "text-slate-300";
      return <div className="min-w-0 text-center" key={step}>
        {isBoil && progress.timerSegments > 0 ? <div aria-label={`테이블끓이기 ${progress.timerElapsedSegments}/10단계`} className="grid h-[3px] overflow-hidden rounded-full" style={{ gridTemplateColumns: "repeat(10, minmax(0, 1fr))" }}>
          {Array.from({ length: 10 }, (_, segment) => <span className={segment < progress.timerElapsedSegments ? "bg-red-500" : "bg-slate-200"} key={segment} />)}
        </div> : <span aria-hidden="true" className={`block h-[3px] rounded-full ${current ? "bg-blue-600" : isWaiting && !past ? "bg-slate-100" : past ? "bg-slate-400" : "bg-slate-200"}`} />}
        <span className={`mt-1 block truncate whitespace-nowrap text-[9px] leading-tight sm:text-[10px] ${colorClass}`}>{label}</span>
      </div>;
    })}
  </div>;
}

function QrReceiptDivider() {
  return <div aria-hidden="true" className="my-2 h-[2px]" style={{
    marginLeft: "calc(50% - 50vw)",
    width: "100vw",
    backgroundImage: "repeating-linear-gradient(to right, #9BA8BA 0 12px, transparent 12px 18px), repeating-linear-gradient(to right, #FFFFFF 0 12px, transparent 12px 18px)",
    backgroundSize: "100% 1px, 100% 1px",
    backgroundPosition: "top, bottom",
    backgroundRepeat: "no-repeat",
  }} />;
}

function QrSummaryDivider() {
  return <div aria-hidden="true" className="relative left-1/2 z-[2] my-3 h-px w-screen -translate-x-1/2 bg-[#D0D8E2]" style={{
    boxShadow: "0 3px 3px rgba(0, 0, 0, 0.2)",
  }} />;
}

function orderPanelGeometry(hasHero: boolean, titleHeight: number): PanelGeometry {
  const viewportHeight = window.innerHeight;
  const topTarget = 6;
  if (!hasHero) {
    const bottomTop = Math.max(topTarget, Math.min(viewportHeight - 72 - 180, viewportHeight * 0.62));
    const middleTop = (topTarget + bottomTop) / 2;
    return { baseTop: middleTop, offsets: [topTarget - middleTop, 0, bottomTop - middleTop] };
  }
  const width = window.innerWidth;
  const heroHeight = width * 0.75;
  const maxPanelTop = Math.max(topTarget, viewportHeight - 72 - 180);
  const bottomTop = Math.max(topTarget, Math.min(heroHeight - titleHeight - 16, maxPanelTop));
  const middleTop = Math.max(topTarget, Math.min(heroHeight / 2 - titleHeight / 2, bottomTop - 48));
  return { baseTop: middleTop, offsets: [topTarget - middleTop, 0, bottomTop - middleTop] };
}

export default function QrOrderHistory({ titleData, notices = [] }: { titleData: QrPublicTitleSettings; notices?: QrPublicNotice[] }) {
  const router = useRouter();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [accessState, setAccessState] = useState<"AUTH_EXPIRED" | "AUTH_REQUIRED" | "PAYMENT_COMPLETED" | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(0);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [panelOffset, setPanelOffset] = useState(0);
  const [panelBaseTop, setPanelBaseTop] = useState<number | null>(null);
  const [panelBackgroundStart, setPanelBackgroundStart] = useState(34);
  const [panelDragging, setPanelDragging] = useState(false);
  const panelOffsetRef = useRef(0);
  const panelSnapIndexRef = useRef<PanelSnapIndex>(1);
  const panelTitleHeightRef = useRef(68);
  const panelDragRef = useRef<PanelDrag | null>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const panelSectionRef = useRef<HTMLElement | null>(null);
  const wheelSettleTimerRef = useRef<number | null>(null);
  const wheelIntentRef = useRef<QrPanelWheelIntent | null>(null);
  const panelFrameRef = useRef<number | null>(null);
  const pendingPanelOffsetRef = useRef<number | null>(null);
  const pointerFallbackRef = useRef<((event: PointerEvent) => void) | null>(null);
  const inviteRequestRef = useRef(false);
  const refreshSequenceRef = useRef(0);

  const setPanelOffsetValue = (offset: number) => {
    panelOffsetRef.current = offset;
    setPanelOffset(offset);
  };
  const schedulePanelOffset = (offset: number) => {
    panelOffsetRef.current = offset;
    pendingPanelOffsetRef.current = offset;
    if (panelFrameRef.current !== null) return;
    panelFrameRef.current = window.requestAnimationFrame(() => {
      panelFrameRef.current = null;
      const nextOffset = pendingPanelOffsetRef.current;
      pendingPanelOffsetRef.current = null;
      if (nextOffset !== null && panelSectionRef.current) {
        panelSectionRef.current.style.transform = `translateY(${nextOffset}px)`;
      }
    });
  };
  const startPanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if ((event.pointerType === "mouse" && event.button !== 0) ||
      target.closest("button, a, input, select, textarea, [role=button], [role=dialog], [contenteditable=true]")) return;
    if (panelDragRef.current) return;
    if (wheelSettleTimerRef.current !== null) {
      window.clearTimeout(wheelSettleTimerRef.current);
      wheelSettleTimerRef.current = null;
    }
    wheelIntentRef.current = null;
    const stops = orderPanelGeometry(titleData.photos.length > 0, panelTitleHeightRef.current).offsets;
    const transform = getComputedStyle(event.currentTarget).transform;
    const matrix = transform.match(/^matrix(3d)?\((.+)\)$/);
    const values = matrix?.[2].split(",").map(Number);
    const renderedOffset = values ? (matrix?.[1] ? values[13] : values[5]) : panelOffsetRef.current;
    const offset = Number.isFinite(renderedOffset) ? renderedOffset : panelOffsetRef.current;
    const startSnapIndex = stops.reduce<PanelSnapIndex>((closest, stop, index) =>
      Math.abs(stop - offset) < Math.abs(stops[closest] - offset) ? index as PanelSnapIndex : closest, 1);
    panelDragRef.current = { pointerId: event.pointerId, startY: event.clientY, lastY: event.clientY,
      startOffset: offset, startSnapIndex, startedAt: event.timeStamp, moved: false };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      const finishFromWindow = (nativeEvent: PointerEvent) => finishPanelDrag(nativeEvent, nativeEvent.type !== "pointerup");
      pointerFallbackRef.current = finishFromWindow;
      window.addEventListener("pointerup", finishFromWindow);
      window.addEventListener("pointercancel", finishFromWindow);
    }
  };
  const movePanelDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 4) return;
    if (!drag.moved) {
      panelOffsetRef.current = drag.startOffset;
      setPanelOffset(drag.startOffset);
      setPanelDragging(true);
    }
    drag.moved = true;
    event.preventDefault();
    const stops = orderPanelGeometry(titleData.photos.length > 0, panelTitleHeightRef.current).offsets;
    const [topOffset, , bottomOffset] = stops;
    const scroll = panelScrollRef.current;
    const deltaY = event.clientY - drag.lastY;
    let offset = panelOffsetRef.current;
    if (offset <= topOffset + 0.5) {
      const maxScrollTop = Math.max(0, (scroll?.scrollHeight ?? 0) - (scroll?.clientHeight ?? 0));
      const currentScrollTop = Math.min(maxScrollTop, Math.max(0, scroll?.scrollTop ?? 0));
      if (scroll && currentScrollTop !== scroll.scrollTop) scroll.scrollTop = currentScrollTop;
      if (deltaY < 0) {
        if (scroll) scroll.scrollTop = Math.min(maxScrollTop, currentScrollTop - deltaY);
      } else {
        const consumedByScroll = Math.min(currentScrollTop, deltaY);
        if (scroll && consumedByScroll > 0) scroll.scrollTop = currentScrollTop - consumedByScroll;
        const remaining = deltaY - consumedByScroll;
        if (remaining > 0) offset = Math.min(stops[Math.min(2, drag.startSnapIndex + 1)], offset + remaining);
      }
    } else {
      const requestedOffset = offset + deltaY;
      if (requestedOffset < topOffset) {
        if (drag.startSnapIndex === 2) {
          offset = stops[1];
        } else {
          const maxScrollTop = Math.max(0, (scroll?.scrollHeight ?? 0) - (scroll?.clientHeight ?? 0));
          if (scroll) scroll.scrollTop = Math.min(maxScrollTop, Math.max(0, scroll.scrollTop) + topOffset - requestedOffset);
          offset = topOffset;
        }
      } else {
        const lowerDragStop = stops[Math.max(0, drag.startSnapIndex - 1)];
        const upperDragStop = stops[Math.min(2, drag.startSnapIndex + 1)];
        if (drag.startSnapIndex === 2 && requestedOffset > bottomOffset) {
          offset = bottomOffset + Math.min(48, (requestedOffset - bottomOffset) * 0.28);
        } else {
          offset = Math.max(lowerDragStop, Math.min(upperDragStop, requestedOffset));
        }
      }
    }
    if (offset !== panelOffsetRef.current) schedulePanelOffset(offset);
    drag.lastY = event.clientY;
  };
  const finishPanelDrag = (event: Pick<PointerEvent, "pointerId" | "clientY" | "timeStamp">, cancelled = false) => {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panelDragRef.current = null;
    if (pointerFallbackRef.current) {
      window.removeEventListener("pointerup", pointerFallbackRef.current);
      window.removeEventListener("pointercancel", pointerFallbackRef.current);
      pointerFallbackRef.current = null;
    }
    if (panelFrameRef.current !== null) {
      window.cancelAnimationFrame(panelFrameRef.current);
      panelFrameRef.current = null;
    }
    pendingPanelOffsetRef.current = null;
    setPanelDragging(false);
    if (!drag.moved) return;
    const stops = orderPanelGeometry(titleData.photos.length > 0, panelTitleHeightRef.current).offsets;
    const currentOffset = panelOffsetRef.current;
    let targetIndex = stops.reduce<PanelSnapIndex>((closest, stop, index) =>
      Math.abs(stop - currentOffset) < Math.abs(stops[closest] - currentOffset) ? index as PanelSnapIndex : closest, 1);
    if (!cancelled && Math.abs(currentOffset - drag.startOffset) > 0.5) {
      const delta = event.clientY - drag.startY;
      const velocity = delta / Math.max(1, event.timeStamp - drag.startedAt);
      if (drag.startSnapIndex > 0 && (delta <= -28 || velocity < -0.35)) targetIndex = (drag.startSnapIndex - 1) as PanelSnapIndex;
      else if (drag.startSnapIndex < 2 && (delta >= 28 || velocity > 0.35)) targetIndex = (drag.startSnapIndex + 1) as PanelSnapIndex;
    }
    panelSnapIndexRef.current = targetIndex;
    setPanelOffsetValue(stops[targetIndex]);
  };

  useEffect(() => {
    const resize = () => {
      const titleCard = document.querySelector<HTMLElement>('[data-qr-menu-background-anchor="title"]');
      if (titleCard) {
        const cardRect = titleCard.getBoundingClientRect();
        const measuredHeight = cardRect.height;
        panelTitleHeightRef.current = measuredHeight;
        const scroller = panelScrollRef.current;
        const scrollerTop = scroller?.getBoundingClientRect().top ?? 0;
        setPanelBackgroundStart(Math.max(0, cardRect.top - scrollerTop + (scroller?.scrollTop ?? 0) + measuredHeight / 2));
      }
      const geometry = orderPanelGeometry(titleData.photos.length > 0, panelTitleHeightRef.current);
      setPanelBaseTop(geometry.baseTop);
      if (!panelDragRef.current) setPanelOffsetValue(geometry.offsets[panelSnapIndexRef.current]);
    };
    const titleCard = document.querySelector<HTMLElement>('[data-qr-menu-background-anchor="title"]');
    const observer = titleCard && typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    if (titleCard && observer) observer.observe(titleCard);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", resize);
    window.addEventListener("resize", resize);
    resize();
    return () => {
      observer?.disconnect();
      visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("resize", resize);
    };
  }, [titleData.photos.length]);

  useEffect(() => {
    const panel = panelSectionRef.current;
    if (!panel) return;

    const clearWheelBurst = () => {
      wheelSettleTimerRef.current = null;
      wheelIntentRef.current = null;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      const scroller = panelScrollRef.current;
      if (!scroller) return;

      let deltaY = event.deltaY;
      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) deltaY *= 16;
      else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) deltaY *= scroller.clientHeight;
      if (!Number.isFinite(deltaY) || deltaY === 0) return;

      event.preventDefault();
      if (panelDragRef.current) return;
      if (wheelSettleTimerRef.current !== null) {
        window.clearTimeout(wheelSettleTimerRef.current);
      }

      const stops = orderPanelGeometry(titleData.photos.length > 0, panelTitleHeightRef.current).offsets;
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const scrollTop = Math.min(maxScrollTop, Math.max(0, scroller.scrollTop));
      if (scrollTop !== scroller.scrollTop) scroller.scrollTop = scrollTop;
      const snapIndex = panelSnapIndexRef.current;

      // Once the panel is fully raised, upward input belongs to the receipt
      // content. No snap timer is allowed to pull it back down.
      if (deltaY < 0) {
        if (snapIndex === 0) {
          scroller.scrollTop = Math.min(maxScrollTop, scrollTop - deltaY);
        } else {
          const result = accumulateQrPanelWheelIntent(wheelIntentRef.current, deltaY);
          if (result) {
            wheelIntentRef.current = result.intent;
            if (result.shouldAdvance) {
              const nextIndex = Math.max(0, snapIndex - 1) as PanelSnapIndex;
              panelSnapIndexRef.current = nextIndex;
              setPanelOffsetValue(stops[nextIndex]);
            }
          }
        }
      } else {
        const contentDelta = Math.min(deltaY, scrollTop);
        if (contentDelta > 0) scroller.scrollTop = scrollTop - contentDelta;
        const remaining = deltaY - contentDelta;
        if (remaining > 0 && snapIndex < 2) {
          const result = accumulateQrPanelWheelIntent(wheelIntentRef.current, remaining);
          if (result) {
            wheelIntentRef.current = result.intent;
            if (result.shouldAdvance) {
              const nextIndex = Math.min(2, snapIndex + 1) as PanelSnapIndex;
              panelSnapIndexRef.current = nextIndex;
              setPanelOffsetValue(stops[nextIndex]);
            }
          }
        }
      }

      // Trackpad deltas accumulate within one gesture. Quiet time only resets
      // the threshold; it never snaps to a nearby offset or reverses input.
      wheelSettleTimerRef.current = window.setTimeout(clearWheelBurst, 180);
    };

    panel.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      panel.removeEventListener("wheel", onWheel);
      if (wheelSettleTimerRef.current !== null) {
        window.clearTimeout(wheelSettleTimerRef.current);
        wheelSettleTimerRef.current = null;
      }
      wheelIntentRef.current = null;
    };
  }, [titleData.photos.length]);

  useEffect(() => () => {
    if (panelFrameRef.current !== null) window.cancelAnimationFrame(panelFrameRef.current);
    if (wheelSettleTimerRef.current !== null) window.clearTimeout(wheelSettleTimerRef.current);
    if (pointerFallbackRef.current) {
      window.removeEventListener("pointerup", pointerFallbackRef.current);
      window.removeEventListener("pointercancel", pointerFallbackRef.current);
    }
    panelFrameRef.current = null;
    wheelSettleTimerRef.current = null;
    pointerFallbackRef.current = null;
    panelDragRef.current = null;
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const requestSequence = ++refreshSequenceRef.current;
    const response = await fetch("/api/qr/table-orders", { cache: "no-store", credentials: "same-origin", signal });
    const data = await response.json() as Payload;
    if (signal?.aborted || requestSequence !== refreshSequenceRef.current) return;
    if (response.ok && data.success && data.accessState === "PAYMENT_COMPLETED") {
      setPayload({ ...data, orders: [], items: [] });
      setAccessState("PAYMENT_COMPLETED");
      setError("");
      setInvite(null);
      setShareOpen(false);
      return;
    }
    if (!response.ok || !data.success) {
      const failure = new Error(data.message ?? "주문내역을 불러오지 못했습니다.") as Error & { status: number; code?: string };
      failure.status = response.status;
      failure.code = typeof data.code === "string" ? data.code : undefined;
      throw failure;
    }
    setPayload(data);
    setAccessState(null);
    setServerOffset((data.serverNow ?? Date.now()) - Date.now());
    setError("");
    if (data.needsJoin && !data.orders?.some(order => order.status === "PENDING")) router.replace("/qrorder/join-required");
    else if (data.orders?.length === 0 && (data.posOrders?.length ?? 0) === 0) router.replace("/qrorder/order");
  }, [router]);

  useEffect(() => {
    let mounted = true;
    let inFlight = false;
    let activeController: AbortController | null = null;
    const load = () => {
      if (!mounted || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      activeController = new AbortController();
      void refresh(activeController.signal).catch(reason => {
        if (!mounted || activeController?.signal.aborted) return;
        const status = reason instanceof Error ? (reason as Error & { status?: number }).status : undefined;
        const code = reason instanceof Error ? (reason as Error & { code?: string }).code : undefined;
        if (status === 401 || status === 409) {
          setPayload(null);
          setAccessState(code === "AUTH_EXPIRED" ? "AUTH_EXPIRED" : "AUTH_REQUIRED");
          setError("");
          setInvite(null);
          setShareOpen(false);
        } else {
          setError(reason instanceof Error ? reason.message : "주문내역을 불러오지 못했습니다.");
        }
      }).finally(() => {
        inFlight = false;
        activeController = null;
      });
    };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") load(); };
    const poll = window.setInterval(load, 5000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    load();
    return () => {
      mounted = false;
      activeController?.abort();
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
    };
  }, [refresh]);

  const orders = payload?.orders ?? emptyOrders;
  const items = payload?.items ?? emptyItems;
  const posOrders = payload?.posOrders ?? emptyPosOrders;
  const posItems = payload?.posItems ?? emptyPosItems;
  const unifiedRounds = useMemo(() => buildUnifiedQrOrderRounds(orders, items, posOrders, posItems), [items, orders, posItems, posOrders]);
  const confirmedSummary = payload?.confirmedSummary;
  const aggregateItems = confirmedSummary?.items ?? [];
  const visibleAggregateItems = aggregateItems.filter(item => item.itemType !== "COMPONENT");
  const rejectedOrder = orders.some(order => order.status === "REJECTED");
  const canUseOrderAction = Boolean(payload?.canViewOrders || rejectedOrder);
  const serverNow = now ? now + serverOffset : payload?.serverNow ?? 0;
  const inviteIsValid = Boolean(invite && Date.parse(invite.expiresAt) > serverNow);

  const createInvite = async () => {
    if (!payload?.canViewOrders || accessState !== null) return;
    if (inviteRequestRef.current) return;
    inviteRequestRef.current = true;
    setShareBusy(true);
    setShareError("");
    setShareMessage("");
    try {
      const response = await fetch("/api/qr/order-invites", { method: "POST", credentials: "same-origin" });
      const result = await response.json() as { success?: boolean; url?: string; expiresAt?: string; message?: string };
      if (!response.ok || !result.success || !result.url || !result.expiresAt) {
        throw new Error(result.message ?? "함께 주문할 QR을 만들지 못했습니다.");
      }
      const qrData = await QRCode.toDataURL(result.url, { width: 280, margin: 1, errorCorrectionLevel: "M" });
      setInvite({ url: result.url, qrData, expiresAt: result.expiresAt });
    } catch (reason) {
      setShareError(reason instanceof Error ? reason.message : "함께 주문할 QR을 만들지 못했습니다.");
    } finally {
      inviteRequestRef.current = false;
      setShareBusy(false);
    }
  };

  const openShare = () => {
    if (!payload?.canViewOrders || accessState !== null) return;
    setShareOpen(true);
    setShareError("");
    const reusableInvite = invite && Date.parse(invite.expiresAt) > serverNow;
    if (!reusableInvite) void createInvite();
  };

  const copyInvite = async () => {
    if (!invite) return;
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(invite.url);
          copied = true;
        } catch { /* Try the browser selection fallback below. */ }
      }
      if (!copied) {
        const input = document.createElement("textarea");
        input.value = invite.url;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        copied = document.execCommand("copy");
        input.remove();
      }
      if (!copied) throw new Error("copy failed");
      setShareMessage("주문 링크를 복사했습니다.");
    } catch {
      setShareError("링크를 복사하지 못했습니다. 주소를 길게 눌러 복사해 주세요.");
    }
  };

  const shareInvite = async () => {
    if (!invite) return;
    if (!navigator.share) {
      await copyInvite();
      return;
    }
    try {
      await navigator.share({ title: "함께 주문하기", text: `테이블 ${payload?.tableNo ?? ""}에서 함께 주문해 주세요.`, url: invite.url });
      setShareMessage("주문 링크를 공유했습니다.");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      await copyInvite();
    }
  };

  const bottomActions = [
    {
      id: "invite",
      label: "주문초대",
      icon: "qr",
      disabled: !payload?.canViewOrders || accessState !== null,
    },
    {
      id: "order",
      label: "주문하기",
      icon: "cart",
      disabled: !canUseOrderAction || accessState !== null,
    },
  ];

  return <main className="min-h-svh w-full bg-slate-50 text-slate-900">
    {titleData.photos.length > 0 && <QrTitleCarousel fixedHero photos={titleData.photos} />}
    <section aria-label="주문내역 패널" className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-2xl" ref={panelSectionRef}
      onLostPointerCapture={event => finishPanelDrag(event.nativeEvent, true)} onPointerCancel={event => finishPanelDrag(event.nativeEvent, true)}
      onPointerDown={startPanelDrag} onPointerMove={movePanelDrag} onPointerUp={event => finishPanelDrag(event.nativeEvent)}
      style={{ top: panelBaseTop === null ? titleData.photos.length ? "calc(37.5vw - 34px)" : "35dvh" : `${panelBaseTop}px`, transform: panelDragging ? undefined : `translateY(${panelOffset}px)`, transition: panelDragging ? "none" : "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)", touchAction: "none", overscrollBehaviorY: "contain" }}>
      <div className="h-full w-full overflow-x-hidden overflow-y-auto" ref={panelScrollRef} style={{ WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain" }} data-qr-content-start>
        <div className="relative min-h-full">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-0 bg-slate-50" style={{ top: `${panelBackgroundStart}px` }} />
          <div className="relative z-10">
            <QrStoreTitle fixedHero orderHistoryHeader notices={notices} onShareTableQr={payload?.canViewOrders && accessState === null ? openShare : undefined} screenSettings={titleData.screenSettings} settings={titleData} />
            <div className="mx-auto mt-4 max-w-lg px-4 pb-4">
      {accessState === "AUTH_EXPIRED" && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">인증 시간이 만료되었습니다.</p>}
      {accessState === "AUTH_REQUIRED" && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700" role="status">테이블 QR을 스캔해 주세요.</p>}
      {accessState === "PAYMENT_COMPLETED" && <div className="mt-3 rounded-xl bg-emerald-50 p-4 text-center text-emerald-800" role="status">
        <p className="font-bold">결제가 완료되었습니다.</p>
        <p className="mt-1 text-sm">이용해 주셔서 감사합니다.</p>
      </div>}
      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {!payload && !error && accessState === null && <p className="py-5 text-center text-sm text-slate-500">주문내역을 불러오는 중입니다.</p>}
      {payload && accessState !== "PAYMENT_COMPLETED" && <section aria-label="전체 주문 집계" className="mt-3">
        <div className="-mx-1 flex min-w-0 items-center justify-between gap-2 rounded-[10px] bg-[#F1F5F9] px-3 py-1.5">
          <h2 className="shrink-0 whitespace-nowrap font-bold">주문집계</h2>
          {typeof payload.totalPersonCount === "number" && payload.totalPersonCount > 0
            ? <strong className="shrink-0 whitespace-nowrap text-sm tabular-nums">{payload.totalPersonCount}명</strong>
            : <span className="shrink-0 whitespace-nowrap text-sm text-slate-500">인원 확인 불가</span>}
        </div>
        {visibleAggregateItems.length > 0 ? <ul className="divide-y divide-slate-200">{visibleAggregateItems.map(item => <li className="py-2" key={item.menuId}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap">
              <span className={`${item.optionLabel ? "min-w-0 max-w-[55%] shrink-0 truncate" : "min-w-0 flex-[0_1_auto] truncate"} font-medium`}>{item.itemName}</span>
              {item.optionLabel && <span className="min-w-0 flex-[0_1_auto] truncate text-xs text-slate-500">{item.optionLabel}</span>}
              <span className="shrink-0 tabular-nums">× {item.qty}</span>
            </div>
            <strong className="shrink-0 tabular-nums">{won(item.totalAmount)}</strong>
          </div>
        </li>)}</ul> : <p className="py-3 text-center text-sm text-slate-500">표시할 확정 주문 메뉴가 없습니다.</p>}
        {confirmedSummary && <>
          <div className="flex items-center justify-between gap-3 py-2 text-base leading-5 font-bold text-blue-700">
            <span>주문금액</span><strong className="shrink-0 tabular-nums">{won(confirmedSummary.grossAmount)}</strong>
          </div>
          {confirmedSummary.discountAmount > 0 && <div className="flex items-center justify-between gap-3 py-1 text-sm text-red-600">
            <span>할인금액</span><strong className="shrink-0 tabular-nums">− {won(confirmedSummary.discountAmount)}</strong>
          </div>}
          {confirmedSummary.prepaidAmount > 0 && <div className="flex items-center justify-between gap-3 py-1 text-sm text-blue-700">
            <span>선결제금액</span><strong className="shrink-0 tabular-nums">− {won(confirmedSummary.prepaidAmount)}</strong>
          </div>}
        </>}
        <QrSummaryDivider />
        {unifiedRounds.length > 0 ? unifiedRounds.map((round, index) => {
          const acceptedPosOrder = round.source === "QR" ? round.acceptedPosOrder : null;
          const orderStatus = acceptedPosOrder?.status === "CANCELLED" || acceptedPosOrder?.status === "COMPLETED"
            ? acceptedPosOrder.status : round.order.status;
          const roundAmount = acceptedPosOrder?.totalAmount ?? round.order.totalAmount;
          const renderPosItem = (item: PosOrderItem) => {
            const progress = getQrCookingProgress({ orderStatus: round.source === "QR" ? round.order.status : "ACCEPTED", stage: item.stage,
              postCookTimerEligible: item.postCookTimerEligible, postCookTimerMinutes: item.postCookTimerMinutes,
              postCookTimerStartedAtMs: item.postCookTimerStartedAtMs }, serverNow);
            return <li className="py-2" key={item.orderItemId}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap">
                  <span className={`${item.options.length ? "max-w-[55%] shrink-0" : "flex-[0_1_auto]"} min-w-0 truncate font-medium ${item.effectiveQty <= 0 ? "text-slate-400 line-through" : ""}`}>{item.itemName}</span>
                  {item.options.length > 0 && <span className="min-w-0 flex-[0_1_auto] truncate text-xs text-slate-500">{item.options.map(option => `${option.optionName}${option.qty > 1 ? ` ×${option.qty}` : ""}`).join(" · ")}</span>}
                  {item.effectiveQty > 0 ? <span className="shrink-0 tabular-nums">× {item.effectiveQty}</span>
                    : <span className="shrink-0 text-xs text-slate-400">취소</span>}
                </div>
                <strong className={`shrink-0 tabular-nums ${item.effectiveQty <= 0 ? "text-slate-400" : ""}`}>{won(item.effectiveTotalAmount)}</strong>
              </div>
              {(round.source === "POS" || acceptedPosOrder) && item.showCookingProgress && item.effectiveQty > 0 && progress && <QrCookingProgressLine progress={progress} />}
            </li>;
          };
          return <div key={`${round.source}-${round.source === "QR" ? round.order.qrOrderId : round.order.orderId}`}>
            <article className="py-2">
              <div className="-mx-1 flex items-center gap-2 rounded-[10px] bg-[#F1F5F9] px-3 py-1.5">
                <h2 className="shrink-0 whitespace-nowrap font-bold">주문 (<time className="font-normal text-slate-500" dateTime={round.order.orderedAt}>{orderTime(round.order.orderedAt)}</time>)</h2>
                {round.source === "QR" ? <>
                  <span className={`min-w-0 flex-1 truncate whitespace-nowrap text-center text-xs font-semibold ${round.order.status === "PENDING" ? "text-amber-700" : round.order.status === "ACCEPTED" ? "text-blue-700" : round.order.status === "REJECTED" ? "text-red-600" : "text-slate-500"}`}>
                    {round.order.status === "PENDING" ? "승인 대기중" : round.order.status === "ACCEPTED" ? "승인완료" : round.order.status === "REJECTED" ? "승인거절" : orderStatus === "COMPLETED" ? "결제 완료" : "주문 취소"}
                  </span>
                  <strong className="shrink-0 whitespace-nowrap text-sm tabular-nums">{won(roundAmount)}</strong>
                </> : <>
                  <span className="min-w-0 flex-1 truncate whitespace-nowrap text-center text-xs font-semibold">
                    <span className="text-blue-700">POS</span>
                    {round.order.status === "CANCELLED" && <span className="text-slate-500"> · 주문 취소</span>}
                    {round.order.status === "COMPLETED" && <span className="text-slate-500"> · 결제 완료</span>}
                  </span>
                  <strong className="shrink-0 whitespace-nowrap text-sm tabular-nums">{won(round.order.totalAmount)}</strong>
                </>}
              </div>
              {round.source === "QR" && round.order.status === "REJECTED" && round.order.note && <p className="mt-1 text-xs leading-5 text-red-600">{round.order.note}</p>}
              {round.source === "QR" ? acceptedPosOrder
                ? <ul className="mt-1 divide-y divide-slate-200">{round.acceptedPosItems.filter(item => item.itemType !== "COMPONENT").map(renderPosItem)}</ul>
                : <ul className="mt-1 divide-y divide-slate-200">{round.items.map(item => {
                  const progress = getQrCookingProgress({ orderStatus: round.order.status, stage: item.stage,
                    postCookTimerEligible: item.postCookTimerEligible, postCookTimerMinutes: item.postCookTimerMinutes,
                    postCookTimerStartedAtMs: item.postCookTimerStartedAtMs }, serverNow);
                  return <li className="py-2" key={item.qrOrderItemId}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap">
                        <span className={item.options.length ? "min-w-0 max-w-[55%] shrink-0 truncate font-medium" : "min-w-0 flex-[0_1_auto] truncate font-medium"}>{item.itemName}</span>
                        {item.options.length > 0 && <span className="min-w-0 flex-[0_1_auto] truncate text-xs font-normal text-slate-500">{item.options.map(option => `${option.optionName}${option.qty > 1 ? ` ×${option.qty}` : ""}`).join(" · ")}</span>}
                        <span className="shrink-0 tabular-nums">× {item.qty}</span>
                      </div>
                      <strong className="shrink-0 tabular-nums">{won(item.totalAmount)}</strong>
                    </div>
                    {item.showCookingProgress && progress && <QrCookingProgressLine progress={progress} />}
                  </li>;
                })}</ul>
                : <ul className="mt-1 divide-y divide-slate-200">{round.items.filter(item => item.itemType !== "COMPONENT").map(renderPosItem)}</ul>}
            </article>
            {index === unifiedRounds.length - 1 ? <QrSummaryDivider /> : <QrReceiptDivider />}
          </div>;
        }) : <p className="py-4 text-center text-sm text-slate-500">표시할 주문 회차가 없습니다.</p>}
      </section>}
            </div>
          </div>
        </div>
      </div>
    </section>

    <nav aria-label="주문내역 하단 메뉴" className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-2xl border-t border-[#D1D5DB] bg-white pb-[env(safe-area-inset-bottom)]">
      <div className="flex min-h-[4.5rem] w-full">
        {bottomActions.map(action => <button className={`flex min-h-[4.5rem] flex-1 flex-col items-center justify-center gap-0.5 bg-white transition-colors active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-gray-500 ${action.disabled ? "text-slate-400" : "text-blue-700"}`} disabled={action.disabled} key={action.id} onClick={() => action.id === "invite" ? openShare() : router.push("/qrorder/order")} type="button">
          {action.icon === "qr"
            ? <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM19 14v2m2 2v3h-3m-4 0h2" /></svg>
            : <svg aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 1.9-1.4L21 8H6" /><circle cx="10" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg>}
          <span className="text-[11px] font-normal leading-tight">{action.label}</span>
        </button>)}
      </div>
    </nav>

    {shareOpen && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" onClick={() => setShareOpen(false)}>
      <section aria-labelledby="qr-share-title" aria-modal="true" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="dialog">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold" id="qr-share-title">함께 주문하기</h2>
          <button aria-label="닫기" className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 text-xl" onClick={() => setShareOpen(false)} type="button">×</button>
        </div>
        <p className="mt-1 text-sm text-slate-600">함께 주문할 사람에게 QR을 공유하세요.</p>
        <p className="mt-3 text-center text-sm font-bold text-slate-700">{payload?.tableNo ? `${payload.tableNo} 테이블` : "테이블 확인 중"}</p>
        {shareBusy && <p className="py-8 text-center text-sm text-slate-500">주문용 QR을 준비하고 있습니다.</p>}
        {shareError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{shareError}</p>}
        {invite && !inviteIsValid && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-800">공유 QR이 만료되었습니다. QR 공유를 다시 눌러 새 링크를 준비해 주세요.</p>}
        {invite && inviteIsValid && <>
          <Image alt="함께 주문할 수 있는 QR 코드" className="mx-auto mt-3 size-64 max-w-full object-contain" height={280} src={invite.qrData} unoptimized width={280} />
          <p className="break-all rounded-lg bg-slate-50 p-3 text-xs text-slate-600">{invite.url}</p>
          <p className="mt-1 text-center text-xs text-slate-500">최초 QR 주문 세션 종료까지 유효 · 만료 {dateTime(invite.expiresAt)}</p>
          {shareMessage && <p aria-live="polite" className="mt-2 text-center text-sm font-semibold text-emerald-700">{shareMessage}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className="min-h-12 rounded-xl bg-blue-700 px-3 text-sm font-bold text-white" onClick={() => void shareInvite()} type="button">공유</button>
            <button className="min-h-12 rounded-xl border border-blue-200 bg-white px-3 text-sm font-bold text-blue-700" onClick={() => void copyInvite()} type="button">링크 복사</button>
          </div>
        </>}
        <button className="mt-2 min-h-11 w-full rounded-xl bg-slate-100 font-bold text-slate-700" onClick={() => setShareOpen(false)} type="button">닫기</button>
      </section>
    </div>}
  </main>;
}
