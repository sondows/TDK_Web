"use client";

import { useEffect, useRef } from "react";

/** Keep the kitchen display awake only while this screen is mounted and visible. */
export function useScreenWakeLock() {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const pendingRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    let active = true;
    const release = (sentinel: WakeLockSentinel) => {
      void Promise.resolve().then(() => sentinel.release()).catch(() => {});
    };

    const acquire = () => {
      if (sentinelRef.current?.released) sentinelRef.current = null;
      if (!active || document.visibilityState !== "visible" || !("wakeLock" in navigator) || sentinelRef.current) return;
      if (pendingRef.current) {
        // A previous mount or visibility change may still be awaiting permission.
        void pendingRef.current.then(() => { if (active) acquire(); });
        return;
      }

      const pending = Promise.resolve().then(() => navigator.wakeLock.request("screen"))
        .then(sentinel => {
          if (!active || document.visibilityState !== "visible" || sentinel.released) {
            release(sentinel);
            return;
          }
          sentinelRef.current = sentinel;
          sentinel.addEventListener("release", () => {
            if (sentinelRef.current === sentinel) sentinelRef.current = null;
          });
        })
        .catch(() => {
          // Permissions, battery saving, or insecure origins may deny the request.
        })
        .finally(() => {
          if (pendingRef.current === pending) pendingRef.current = null;
        });
      pendingRef.current = pending;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    acquire();

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      if (sentinel) release(sentinel);
    };
  }, []);
}
