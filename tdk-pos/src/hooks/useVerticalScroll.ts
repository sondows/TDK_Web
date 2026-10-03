"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Overflow hints and layout observation for a vertical snap list. */
export function useVerticalScroll(contentKey?: string | number) {
  const ref = useRef<HTMLDivElement>(null);
  const [hints, setHints] = useState({ above: false, below: false });

  const updateHints = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const above = element.scrollTop > 2;
    const below = element.scrollHeight - element.clientHeight - element.scrollTop > 2;
    setHints(current => current.above === above && current.below === below ? current : { above, below });
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(updateHints);
    resizeObserver.observe(element);
    const mutationObserver = new MutationObserver(updateHints);
    mutationObserver.observe(element, { childList: true, subtree: true });
    const frame = requestAnimationFrame(updateHints);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [contentKey, updateHints]);

  return { ref, hints, onScroll: updateHints };
}
