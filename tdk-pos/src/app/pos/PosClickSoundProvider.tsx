"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { playPosClickSound, preloadPosClickSound, unlockPosClickSound } from "@/lib/pos-sound";

function interactiveElement(target: EventTarget | null, root: HTMLElement) {
  if (!(target instanceof Element)) return null;
  const element = target.closest("button, [role=button]");
  if (!(element instanceof HTMLElement) || !root.contains(element)) return null;
  if (element instanceof HTMLButtonElement && element.disabled) return null;
  if (element.getAttribute("aria-disabled") === "true") return null;
  return element;
}

export default function PosClickSoundProvider({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    preloadPosClickSound();
    const root = rootRef.current;
    if (!root) return;

    const onPointerDown = (event: Event) => {
      if (interactiveElement(event.target, root)) {
        unlockPosClickSound();
        void playPosClickSound();
      }
    };
    const onKeyDown = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (!keyEvent.repeat && (keyEvent.key === "Enter" || keyEvent.key === " ") && interactiveElement(keyEvent.target, root)) {
        unlockPosClickSound();
        void playPosClickSound();
      }
    };

    root.addEventListener("pointerdown", onPointerDown, { capture: true });
    root.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      root.removeEventListener("pointerdown", onPointerDown, { capture: true });
      root.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, []);

  return <div className="contents" ref={rootRef}>{children}</div>;
}
