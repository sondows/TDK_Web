"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QrTitleSnapDetail, QrTitleSnapHandlerRef } from "@/app/qr/QrStoreTitle";

type Props = { title: string; tableNo?: string | null; fetchTableNo?: boolean; fixedImageOverlay?: boolean; snapHandlerRef?: QrTitleSnapHandlerRef };

export default function QrOrderTitleBar({ title, tableNo = null, fetchTableNo = false, fixedImageOverlay = false, snapHandlerRef }: Props) {
  const [fetchedTableNo, setFetchedTableNo] = useState<string | null>(null);
  const [pushOffset, setPushOffset] = useState(0);
  const [lowerSnapAnimating, setLowerSnapAnimating] = useState(false);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!fetchTableNo) return;
    const controller = new AbortController();
    void fetch("/api/qr/table-orders", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then(async response => response.ok ? await response.json() as { success?: boolean; tableNo?: string } : null)
      .then(payload => { if (payload?.success && payload.tableNo) setFetchedTableNo(payload.tableNo); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [fetchTableNo]);

  useLayoutEffect(() => {
    if (!fixedImageOverlay) return;
    let frame = 0;
    let trackingBoxTransition = false;
    let lowerSnapSettling = false;
    let lowerSnapMaxOffset = 0;
    let previousSnapOffset = 0;
    const titleBox = document.querySelector<HTMLElement>('[data-qr-menu-background-anchor="title"]');
    const measure = () => {
      frame = 0;
      if (lowerSnapSettling) return;
      if (!titleBox) return;
      const bar = barRef.current;
      if (!bar) return;

      // Use the bar's untransformed bounds as the stable reference so its own
      // upward transform cannot feed back into the collision calculation.
      const barStyle = window.getComputedStyle(bar);
      const barTop = Number.parseFloat(barStyle.top) || 0;
      const barHeight = bar.getBoundingClientRect().height;
      const originalBarBottom = barTop + barHeight;
      const boxTop = titleBox.getBoundingClientRect().top;
      const contactGap = 8;
      const boxTransform = window.getComputedStyle(titleBox).transform;
      const currentSnapOffset = boxTransform === "none" ? 0 : new DOMMatrixReadOnly(boxTransform).m42;
      const maxHideOffset = barHeight + 2;
      const atLowerSnap = lowerSnapMaxOffset > 0 && currentSnapOffset >= lowerSnapMaxOffset - 0.5;
      const nextOffset = currentSnapOffset > 0 && lowerSnapMaxOffset > 0
        // Downward snap retains the original behavior: the bar hides in step
        // with the box's positive movement and is fully hidden at the lower stop.
        ? atLowerSnap
          ? maxHideOffset
          : Math.max(0, Math.min(maxHideOffset, currentSnapOffset / lowerSnapMaxOffset * maxHideOffset))
        // Upward movement uses the real gap. The bar stays still until 8px,
        // then follows the box while never going below its original position.
        : Math.max(0, Math.min(maxHideOffset, originalBarBottom + contactGap - boxTop));

      setPushOffset(current => Math.abs(current - nextOffset) < 0.25 ? current : nextOffset);
      // During the box's CSS snap animation, sample each rendered frame so
      // the bar follows its actual position instead of running a second,
      // independent easing animation.
      if (trackingBoxTransition) frame = window.requestAnimationFrame(measure);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const onTitleSnap = (detail: QrTitleSnapDetail) => {
      const nextMax = Number(detail?.maxOffset);
      if (Number.isFinite(nextMax)) lowerSnapMaxOffset = Math.max(0, nextMax);
      const nextOffset = Number(detail?.offset);
      const hasOffset = Number.isFinite(nextOffset);
      const isDragging = detail?.dragging === true;
      const isReturningFromLower = hasOffset && nextOffset === 0 && previousSnapOffset > 0;

      if (isDragging) {
        lowerSnapSettling = false;
        setLowerSnapAnimating(false);
        if (hasOffset && nextOffset > 0 && lowerSnapMaxOffset > 0) {
          const barHeight = barRef.current?.getBoundingClientRect().height ?? 48;
          const maxHideOffset = barHeight + 2;
          const dragHideOffset = Math.max(0, Math.min(maxHideOffset, nextOffset / lowerSnapMaxOffset * maxHideOffset));
          setPushOffset(current => Math.abs(current - dragHideOffset) < 0.25 ? current : dragHideOffset);
        } else {
          onScroll();
        }
      } else if (hasOffset && (nextOffset > 0 || isReturningFromLower)) {
        // Make the lower stop authoritative. Matching the box's 300ms snap
        // transition avoids depending on a final animation-frame measurement.
        lowerSnapSettling = true;
        setLowerSnapAnimating(true);
        const barHeight = barRef.current?.getBoundingClientRect().height ?? 48;
        setPushOffset(nextOffset > 0 ? barHeight + 2 : 0);
      } else {
        lowerSnapSettling = false;
        setLowerSnapAnimating(false);
        onScroll();
      }
      if (hasOffset) previousSnapOffset = nextOffset;
    };
    const onBoxTransition = (event: TransitionEvent) => {
      if (!titleBox) return;
      if (event.target !== titleBox || event.propertyName !== "transform") return;
      trackingBoxTransition = event.type === "transitionrun";
      if (event.type !== "transitionrun" && lowerSnapSettling) {
        lowerSnapSettling = false;
        setLowerSnapAnimating(false);
      }
      onScroll();
    };
    if (snapHandlerRef) snapHandlerRef.current = onTitleSnap;
    const initialFrame = titleBox ? window.requestAnimationFrame(measure) : 0;
    if (titleBox) {
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      titleBox.addEventListener("transitionrun", onBoxTransition);
      titleBox.addEventListener("transitionend", onBoxTransition);
      titleBox.addEventListener("transitioncancel", onBoxTransition);
    }
    return () => {
      if (initialFrame) window.cancelAnimationFrame(initialFrame);
      if (frame) window.cancelAnimationFrame(frame);
      if (titleBox) {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
        titleBox.removeEventListener("transitionrun", onBoxTransition);
        titleBox.removeEventListener("transitionend", onBoxTransition);
        titleBox.removeEventListener("transitioncancel", onBoxTransition);
      }
      if (snapHandlerRef?.current === onTitleSnap) snapHandlerRef.current = null;
    };
  }, [fixedImageOverlay, snapHandlerRef]);

  const isOrderButtonTitle = title === "\uC8FC\uBB38\uD558\uAE30";
  const displayedTableNo = fetchTableNo ? fetchedTableNo : tableNo;
  const barHeight = isOrderButtonTitle ? 48 : 60;
  const fullyHidden = pushOffset >= barHeight;

  return <header aria-label="QR order screen" aria-hidden={fullyHidden} className={`mx-auto flex ${isOrderButtonTitle ? "min-h-12 py-1" : "min-h-[3.75rem] py-1.5"} w-2/3 max-w-md flex-col items-center justify-center rounded-b-2xl bg-blue-700 px-3 text-center text-white shadow-md ${fixedImageOverlay ? "fixed left-1/2 top-0 z-20" : "relative"}`} data-qr-order-title-bar ref={barRef} style={fixedImageOverlay ? { transform: `translate(-50%, -${pushOffset}px)`, transition: lowerSnapAnimating ? "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)" : "none", pointerEvents: fullyHidden ? "none" : "auto" } : undefined}>
    <h1 className={`max-w-full break-words font-extrabold leading-tight ${isOrderButtonTitle ? "text-[clamp(1.25rem,5.5vw,1.375rem)]" : "text-base"}`}>
      {isOrderButtonTitle ? <span className="relative inline-block">{title}{displayedTableNo && <sup className="absolute left-full top-0 ml-1 -translate-y-1/4 whitespace-nowrap text-[0.55em] font-bold leading-none text-white">{displayedTableNo}</sup>}</span> : title}
    </h1>
    {!isOrderButtonTitle && <p className="mt-0.5 text-xs font-semibold leading-tight text-blue-100">{"\uD14C\uC774\uBE14"} {displayedTableNo ?? "\u2014"}</p>}
  </header>;
}
