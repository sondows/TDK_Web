"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Shared overflow hints and mouse dragging for one-row button scrollers. */
export function useHorizontalScroll(ready = true, contentKey?: string, wheelToHorizontal = true) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startScrollLeft: number; dragged: boolean } | null>(null);
  const dragClickRef = useRef(false);
  const cancelSnapRef = useRef<(() => void) | null>(null);
  const wheelTimerRef = useRef<number | null>(null);
  const [hints, setHints] = useState({ left: false, right: false });

  const updateHints = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const left = element.scrollLeft > 2;
    const right = element.scrollWidth - element.clientWidth - element.scrollLeft > 2;
    setHints(current => current.left === left && current.right === right ? current : { left, right });
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!ready || !element) return;
    const observer = new ResizeObserver(updateHints);
    observer.observe(element);
    const mutationObserver = new MutationObserver(updateHints);
    mutationObserver.observe(element, { childList: true });
    window.addEventListener("resize", updateHints);
    const frame = requestAnimationFrame(updateHints);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", updateHints);
    };
  }, [ready, contentKey, updateHints]);

  useEffect(() => () => {
    cancelSnapRef.current?.();
    if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
  }, []);

  const finishScroll = (element: HTMLDivElement) => {
    const current = element.scrollLeft;
    const max = element.scrollWidth - element.clientWidth;
    const viewportLeft = element.getBoundingClientRect().left;
    const positions = [...element.querySelectorAll(":scope > button")].map(button =>
      Math.max(0, Math.min(max, current + button.getBoundingClientRect().left - viewportLeft)),
    );
    const nearest = positions.reduce((best, position) =>
      Math.abs(position - current) < Math.abs(best - current) ? position : best, 0);
    if (Math.abs(nearest - current) < 2) {
      delete element.dataset.dragging;
      return;
    }

    const cancel = () => {
      element.removeEventListener("scrollend", complete);
      window.clearTimeout(fallback);
      cancelSnapRef.current = null;
    };
    const complete = () => {
      if (cancelSnapRef.current !== cancel) return;
      cancel();
      delete element.dataset.dragging;
    };
    cancelSnapRef.current = cancel;
    element.scrollTo({ left: nearest, behavior: "smooth" });
    element.addEventListener("scrollend", complete);
    const fallback = window.setTimeout(complete, 500);
  };

  const handlers = {
    onScroll: updateHints,
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      cancelSnapRef.current?.();
      if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
      event.currentTarget.dataset.dragging = "true";
      dragClickRef.current = false;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScrollLeft: event.currentTarget.scrollLeft,
        dragged: false,
      };
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const distance = event.clientX - drag.startX;
      if (!drag.dragged && Math.abs(distance) < 5) return;
      if (!drag.dragged) {
        drag.dragged = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      dragClickRef.current = true;
      event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
      event.preventDefault();
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag?.pointerId !== event.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
      if (drag.dragged) finishScroll(event.currentTarget);
      else delete event.currentTarget.dataset.dragging;
    },
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
      dragRef.current = null;
      dragClickRef.current = false;
      delete event.currentTarget.dataset.dragging;
    },
    onPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId) || cancelSnapRef.current) return;
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      delete event.currentTarget.dataset.dragging;
    },
    onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
      if (!dragClickRef.current) return;
      dragClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onWheel: (event: React.WheelEvent<HTMLDivElement>) => {
      if (wheelToHorizontal && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
        cancelSnapRef.current?.();
        event.currentTarget.dataset.dragging = "true";
        event.currentTarget.scrollLeft += event.deltaY;
        if (wheelTimerRef.current !== null) window.clearTimeout(wheelTimerRef.current);
        const element = event.currentTarget;
        wheelTimerRef.current = window.setTimeout(() => {
          wheelTimerRef.current = null;
          finishScroll(element);
        }, 120);
      }
    },
  };

  return { ref, hints, handlers };
}
